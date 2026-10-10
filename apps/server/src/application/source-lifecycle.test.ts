import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { describe, expect, it, vi } from 'vitest'
import { createConfigurationDocument } from '../configuration/document.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type { LocalObservationInput } from '../observation/coordinator.ts'
import type { SourceObserver } from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import { readApplicationState } from '../public-test-fixtures.ts'
import { readLocalProject } from '../wayfinder/from-local.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

async function fixture(disposalFailure?: Error) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-source-lifecycle-')))
  const first = join(root, 'first')
  const second = join(root, 'second')
  await Promise.all(
    [first, second].map((path) => mkdir(join(path, '.wayfinder'), { recursive: true })),
  )
  const initial: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: [
      {
        ref: { integration: 'local', projectId: 'first' },
        connectionId: 'local',
        workspace: { path: first },
      },
    ],
    automation: { enabled: false, enabledProjects: [] },
  }
  const filename = join(root, 'roadmap.config.json')
  await writeFile(filename, JSON.stringify(initial))
  const document = createConfigurationDocument(filename, { debounceMs: 1 })
  const watchers: Array<{
    id: string
    closed: boolean
    closes: number
    dirty(): void
    error(): void
  }> = []
  const inputs: LocalObservationInput[] = []
  const owners: SourceObserver[] = []
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let gatedId: string | null = null
  let failRead = false
  const application = createRoadmapApplication({
    configuration: document,
    admissions: { local: createLocalProjectAdmission() },
    operations: createApplicationOperations({
      host: {
        async execute() {
          throw new Error('No host operation belongs to this schedule.')
        },
      },
    }),
    observers: {
      local(input) {
        inputs.push(input)
        const owner = createLocalObserver(input, {
          debounceMs: 1,
          pathExists: async () => true,
          watchDirectory(_path, onDirty, onError) {
            const watcher = {
              id: input.ref.projectId,
              closed: false,
              closes: 0,
              dirty: onDirty,
              error: () => onError(new Error('Controlled watcher failure')),
              close() {
                this.closes += 1
                this.closed = true
                if (disposalFailure) throw disposalFailure
              },
            }
            watchers.push(watcher)
            return watcher
          },
          async readProject(source, options) {
            if (source.ref.projectId === gatedId) {
              entered.resolve()
              await release.promise
              if (failRead) throw new Error('Controlled late Local read failure')
            }
            return readLocalProject(source, options)
          },
          logger: { info() {}, warn() {} },
        })
        owners.push(owner)
        return owner
      },
      github() {
        throw new Error('No GitHub source belongs to this schedule.')
      },
    },
  })
  return {
    root,
    first,
    second,
    initial,
    document,
    application,
    watchers,
    inputs,
    entered: entered.promise,
    gate(id: string, fail = false) {
      gatedId = id
      failRead = fail
    },
    release() {
      release.resolve()
    },
    async cleanup(expectedApplicationFailure?: unknown) {
      release.resolve()
      const results = await Promise.allSettled([
        application.stop(),
        ...owners.map((owner) => owner.stop()),
        document.stop(),
      ])
      await rm(root, { recursive: true, force: true })
      const failures = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return []
        const expected = index === 0 ? expectedApplicationFailure : disposalFailure
        if (index <= owners.length && expected !== undefined && result.reason === expected)
          return []
        return [result.reason]
      })
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'Source fixture cleanup failed.')
    },
  }
}

describe('RoadmapApplication source lifetimes', () => {
  it.each(['success', 'failure'] as const)(
    'retires and joins a pending baseline with late %s',
    async (outcome) => {
      const test = await fixture()
      test.gate('first', outcome === 'failure')
      const states: ReadyApplicationState[] = []
      test.application.subscribe((state) => states.push(readApplicationState(state)))
      const start = test.application.start().then(
        () => 'resolved',
        () => 'rejected',
      )
      try {
        await test.entered
        let stopped = false
        const stop = test.application.stop().then(() => {
          stopped = true
        })
        const secondStop = test.application.stop()
        await setImmediate()
        expect(test.watchers).toHaveLength(1)
        expect(test.watchers[0]?.closed).toBe(true)
        expect(stopped).toBe(false)
        const beforeCompletion = states.length
        test.release()
        expect(await start).toBe('rejected')
        await Promise.all([stop, secondStop])
        test.watchers[0]?.dirty()
        test.watchers[0]?.error()
        await setImmediate()
        expect(states).toHaveLength(beforeCompletion)
        await expect(test.application.start()).rejects.toThrow()
      } finally {
        test.release()
        await start
        await test.cleanup()
      }
    },
  )

  it('keeps committed owners authoritative while a candidate baseline remains pending', async () => {
    const test = await fixture()
    const states: ReadyApplicationState[] = []
    test.application.subscribe((state) => states.push(readApplicationState(state)))
    try {
      await test.application.start()
      states.length = 0
      test.gate('second')
      await test.document.write({
        ...test.initial,
        configurationVersion: 2,
        projects: [
          ...test.initial.projects,
          {
            ref: { integration: 'local', projectId: 'second' },
            connectionId: 'local',
            workspace: { path: test.second },
          },
        ],
      })
      await test.entered
      expect(readApplicationState(test.application.current()).configurationVersion).toBe(1)
      expect(
        readApplicationState(test.application.current()).projects.map(
          (project) => project.ref.projectId,
        ),
      ).toEqual(['first'])
      expect(test.inputs.map((input) => input.ref.projectId)).toEqual(['first', 'second'])
      expect(test.watchers[0]?.closed).toBe(false)
      const beforeActiveUpdate = readApplicationState(test.application.current()).stateSequence
      test.watchers[0]?.dirty()
      await vi.waitFor(() =>
        expect(readApplicationState(test.application.current()).stateSequence).toBeGreaterThan(
          beforeActiveUpdate,
        ),
      )
      for (const state of states) {
        expect(state.configurationVersion).toBe(1)
        expect(state.projects.map((project) => project.ref.projectId)).toEqual(['first'])
      }
      const stop = test.application.stop()
      await setImmediate()
      expect(test.watchers.every((watcher) => watcher.closed)).toBe(true)
      const beforeCompletion = states.length
      test.release()
      await stop
      expect(readApplicationState(test.application.current()).configurationVersion).toBe(1)
      expect(states).toHaveLength(beforeCompletion)
      expect(test.inputs).toHaveLength(2)
    } finally {
      await test.cleanup()
    }
  })

  it('reports source disposal failure to every concurrent application stop caller', async () => {
    const failure = new Error('Controlled source disposal failure')
    const test = await fixture(failure)
    let expectedApplicationFailure: unknown
    try {
      await test.application.start()
      const results = await Promise.allSettled([
        test.application.stop(),
        test.application.stop(),
        test.application.stop(),
      ])
      expect(test.watchers[0]?.closes).toBe(1)
      expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected'])
      const first = results[0]
      if (first?.status !== 'rejected')
        throw new Error('Shutdown must report source disposal failure.')
      expectedApplicationFailure = first.reason
      for (const result of results) {
        if (result.status !== 'rejected') throw new Error('Every caller must join failed disposal.')
        expect(result.reason).toBe(first.reason)
      }
    } finally {
      await test.cleanup(expectedApplicationFailure)
    }
  })

  it('disposes acquired source owners and configuration watching when later startup fails', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-startup-disposal-')))
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, '.wayfinder'), { recursive: true })
    const filename = join(root, 'roadmap.config.json')
    await writeFile(
      filename,
      JSON.stringify({
        schemaVersion: 6,
        configurationVersion: 1,
        connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
        projects: [
          {
            ref: { integration: 'local', projectId: 'workspace' },
            connectionId: 'local',
            workspace: { path: workspace },
          },
        ],
        automation: { enabled: false, enabledProjects: [] },
      }),
    )
    const document = createConfigurationDocument(filename, { debounceMs: 1 })
    let closed = false
    let dirty: (() => void) | undefined
    const startupFailure = new Error('Controlled durable history load failure')
    const states: ReadyApplicationState[] = []
    const owners: SourceObserver[] = []
    const application = createRoadmapApplication({
      configuration: document,
      admissions: { local: createLocalProjectAdmission() },
      observers: {
        local(input) {
          const owner = createLocalObserver(input, {
            pathExists: async () => true,
            watchDirectory(_path, onDirty) {
              dirty = onDirty
              return {
                close() {
                  closed = true
                },
              }
            },
            logger: { info() {}, warn() {} },
          })
          owners.push(owner)
          return owner
        },
        github() {
          throw new Error('No GitHub source belongs to this schedule.')
        },
      },
      automation: {
        database: {
          async load() {
            throw startupFailure
          },
          async append() {
            throw new Error('No append belongs to failed history loading.')
          },
        },
        launcher: {
          classify() {
            throw new Error('No classification belongs to this schedule.')
          },
          async dispatch() {
            throw new Error('No Session launch belongs to this schedule.')
          },
        },
      },
    })
    application.subscribe((state) => states.push(readApplicationState(state)))
    try {
      await expect(application.start()).rejects.toBe(startupFailure)
      expect(closed).toBe(true)
      expect(
        await document.write({
          schemaVersion: 6,
          configurationVersion: 2,
          connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
          projects: [],
          automation: { enabled: false, enabledProjects: [] },
        }),
      ).toMatchObject({ ok: false, kind: 'persistence' })
      const beforeLateCallbacks = states.length
      dirty?.()
      await writeFile(filename, '{ invalid after failed startup')
      await setImmediate()
      expect(states).toHaveLength(beforeLateCallbacks)
      await Promise.all([application.stop(), application.stop()])
      await expect(application.start()).rejects.toThrow()
    } finally {
      await application.stop()
      await Promise.all(owners.map((owner) => owner.stop()))
      await document.stop()
      await rm(root, { recursive: true, force: true })
    }
  })
})
