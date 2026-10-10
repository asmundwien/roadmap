import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { commandSchema } from '@roadmap/contracts/operations'
import type { ApplicationState, ReadyApplicationState } from '@roadmap/contracts/state'
import { describe, expect, it } from 'vitest'
import type { AutomationDatabaseDocument } from '../automation/database.ts'
import type { AutomationLauncher } from '../automation/engine.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
} from '../configuration/document.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type { SourceObserverFactories } from '../observation/coordinator.ts'
import type { SourceObserver } from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import { readApplicationState } from '../public-test-fixtures.ts'
import { readLocalProject } from '../wayfinder/from-local.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const CONFIGURATION: ProjectConfiguration = {
  schemaVersion: 6,
  configurationVersion: 1,
  connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
  projects: [],
  automation: { enabled: false, enabledProjects: [] },
}

function outcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true, value }) satisfies { ok: true; value: T },
    (error: unknown) => ({ ok: false, error }) satisfies { ok: false; error: unknown },
  )
}

function configurationFixture(initial: ConfigurationRead = { ok: true, document: CONFIGURATION }) {
  const listeners = new Set<(read: ConfigurationRead) => void>()
  const writes: ProjectConfiguration[] = []
  const effects = { loads: 0, subscriptions: 0, disposals: 0, stops: 0 }
  const document: ConfigurationDocument = {
    async load() {
      effects.loads += 1
      return initial
    },
    subscribe(listener) {
      effects.subscriptions += 1
      listeners.add(listener)
      return () => {
        if (listeners.delete(listener)) effects.disposals += 1
      }
    },
    async write(next): Promise<ConfigurationWrite> {
      writes.push(next)
      initial = { ok: true, document: next }
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {
      effects.stops += 1
    },
  }
  return {
    document,
    effects,
    writes,
    get subscriptions() {
      return listeners.size
    },
    emit(read: ConfigurationRead) {
      for (const listener of listeners) listener(read)
    },
  }
}

function noSources(): SourceObserverFactories {
  return {
    local() {
      throw new Error('An empty configuration must not acquire a Local observer.')
    },
    github() {
      throw new Error('An empty configuration must not acquire a GitHub observer.')
    },
  }
}

const noLaunch: AutomationLauncher = {
  classify() {
    throw new Error('This lifecycle schedule must not launch Classification.')
  },
  async dispatch() {
    throw new Error('This lifecycle schedule must not launch a Wayfinder Session.')
  },
}

describe('RoadmapApplication terminal lifecycle', () => {
  it.each(['confirmed', 'unconfirmed', 'cleanup-rejected'])(
    'preserves the actual drained saved document in final stopped state after %s',
    async (caseName) => {
      const configuration = configurationFixture()
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      const application = createRoadmapApplication({
        configuration: {
          ...configuration.document,
          async write(next): Promise<ConfigurationWrite> {
            entered.resolve()
            await released.promise
            configuration.writes.push(next)
            return {
              ok: true,
              durability: caseName === 'unconfirmed' ? 'unconfirmed' : 'confirmed',
            }
          },
          async stop() {
            if (caseName === 'cleanup-rejected') throw new Error('Actual fixture cleanup failure.')
          },
        },
        admissions: {},
        observers: noSources(),
      })
      await application.start()
      const command = application.execute(
        commandSchema.parse({
          type: 'rename-connection',
          connectionId: 'local',
          name: 'Actually saved during stop',
          expectedConfigurationVersion: 1,
        }),
      )
      await entered.promise
      const stopping = outcome(application.stop())
      released.resolve()
      const result = await command
      const stopped = await stopping
      expect(result).toMatchObject({
        ok: true,
        operation: 'rename-connection',
        subject: { kind: 'connection', connectionId: 'local' },
        result: {
          type: 'rename-connection',
          connectionId: 'local',
          configurationVersion: 2,
          commit: caseName === 'unconfirmed' ? 'committed-unconfirmed' : 'committed',
        },
      })
      expect(result).not.toHaveProperty('state')
      expect(stopped.ok).toBe(caseName !== 'cleanup-rejected')
      expect(configuration.writes).toMatchObject([
        { configurationVersion: 2, connections: [{ name: 'Actually saved during stop' }] },
      ])
      expect(application.current()).toMatchObject({
        phase: 'stopped',
        retained: {
          configurationVersion: 2,
          connections: [{ id: 'local', name: 'Actually saved during stop' }],
        },
      })
    },
  )
  it('distinguishes initial unreadiness from a ready known-empty Project authority', async () => {
    const loaded = Promise.withResolvers<ConfigurationRead>()
    const entered = Promise.withResolvers<void>()
    const configuration = configurationFixture()
    const application = createRoadmapApplication({
      configuration: {
        ...configuration.document,
        async load() {
          entered.resolve()
          return loaded.promise
        },
      },
      admissions: {},
      observers: noSources(),
    })
    const published: ReadyApplicationState[] = []
    application.subscribe((state) => published.push(readApplicationState(state)))
    expect(application.current()).toMatchObject({ phase: 'idle' })
    expect(application.current()).not.toHaveProperty('projects')
    const starting = application.start()
    try {
      await entered.promise
      expect(application.current()).toMatchObject({ phase: 'starting' })
      expect(application.current()).not.toHaveProperty('projects')
      expect(published).toEqual([])
      loaded.resolve({ ok: true, document: CONFIGURATION })
      await starting
      expect(application.current()).toMatchObject({ phase: 'ready', projects: [] })
      expect(application.current()).not.toHaveProperty('registrations')
      expect(application.current()).not.toHaveProperty('roadmap')
      expect(published).not.toEqual([])
      await application.stop()
      expect(application.current()).toMatchObject({ phase: 'stopped' })
      expect(application.current()).not.toHaveProperty('projects')
    } finally {
      loaded.resolve({ ok: true, document: CONFIGURATION })
      await starting.catch(() => {})
      await application.stop()
    }
  })

  it('makes stop before start terminal without loading or subscribing to configuration', async () => {
    const configuration = configurationFixture()
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: {},
      observers: noSources(),
    })

    await application.stop()
    expect(await outcome(application.start())).toMatchObject({ ok: false })
    await application.stop()
    const states: ReadyApplicationState[] = []
    application.subscribe((state) => states.push(readApplicationState(state)))
    configuration.emit({ ok: true, document: { ...CONFIGURATION, configurationVersion: 2 } })

    expect(configuration.effects).toEqual({ loads: 0, subscriptions: 0, disposals: 0, stops: 1 })
    expect(states).toEqual([])
    expect(application.diagnostics().lifecycle).toEqual({ phase: 'stopped' })
  })

  it('shares concurrent startup and does not reacquire configuration on repeated ready starts', async () => {
    const loaded = Promise.withResolvers<ConfigurationRead>()
    const entered = Promise.withResolvers<void>()
    const configuration = configurationFixture()
    const application = createRoadmapApplication({
      configuration: {
        ...configuration.document,
        async load() {
          configuration.effects.loads += 1
          entered.resolve()
          return loaded.promise
        },
      },
      admissions: {},
      observers: noSources(),
    })
    const first = outcome(application.start())
    const second = outcome(application.start())
    try {
      await entered.promise
      expect(configuration.effects.loads).toBe(1)
      expect(configuration.subscriptions).toBe(0)
      loaded.resolve({ ok: true, document: CONFIGURATION })
      expect(await Promise.all([first, second])).toEqual([
        { ok: true, value: undefined },
        { ok: true, value: undefined },
      ])
      await application.start()
      expect(configuration.effects.loads).toBe(1)
      expect(configuration.effects.subscriptions).toBe(1)
      expect(readApplicationState(application.current()).configurationVersion).toBe(1)
      expect(application.diagnostics().lifecycle).toEqual({ phase: 'ready', mode: 'mutable' })
      expect(application.diagnostics()).toMatchObject({
        projects: 0,
        maps: 0,
        unavailable: 0,
        absent: 0,
      })
    } finally {
      loaded.resolve({ ok: true, document: CONFIGURATION })
      await Promise.all([first, second])
      await application.stop()
    }
  })

  it.each(['success', 'failure'] as const)(
    'joins the same concurrent and repeated stop completion after cleanup %s',
    async (completion) => {
      const cleanup = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const configuration = configurationFixture()
      const failure = new Error('Configuration cleanup failed.')
      const application = createRoadmapApplication({
        configuration: {
          ...configuration.document,
          async stop() {
            configuration.effects.stops += 1
            entered.resolve()
            await cleanup.promise
            if (completion === 'failure') throw failure
          },
        },
        admissions: {},
        observers: noSources(),
      })
      await application.start()
      let settled = false
      const first = application.stop()
      const firstResult = outcome(first).then((result) => {
        settled = true
        return result
      })
      const second = application.stop()
      const secondResult = outcome(second)
      try {
        await entered.promise
        await setImmediate()
        expect(settled).toBe(false)
        expect(second).toBe(first)
        expect(configuration.subscriptions).toBe(0)
        cleanup.resolve()
        const expected =
          completion === 'success' ? { ok: true, value: undefined } : { ok: false, error: failure }
        expect(await firstResult).toEqual(expected)
        expect(await secondResult).toEqual(expected)
        expect(application.stop()).toBe(first)
        expect(await outcome(application.stop())).toEqual(expected)
        expect(configuration.effects.stops).toBe(1)
        expect(await outcome(application.start())).toMatchObject({ ok: false })
        const terminalStates: ApplicationState[] = []
        application.subscribe((state) => terminalStates.push(state))
        expect(terminalStates).toEqual([])
        expect(application.diagnostics().lifecycle).toEqual({ phase: 'stopped' })
      } finally {
        cleanup.resolve()
        await Promise.all([firstResult, secondResult])
      }
    },
  )

  it('cleans up a rejected configuration load before startup rejects and never retries', async () => {
    const configuration = configurationFixture()
    const failure = new Error('Private configuration read detail.')
    const application = createRoadmapApplication({
      configuration: {
        ...configuration.document,
        async load() {
          configuration.effects.loads += 1
          throw failure
        },
      },
      admissions: {},
      observers: noSources(),
    })
    const result = await outcome(application.start())

    expect(result).toEqual({ ok: false, error: failure })
    expect(configuration.effects.stops).toBe(1)
    expect(configuration.subscriptions).toBe(0)
    expect(await outcome(application.start())).toMatchObject({ ok: false })
    expect(configuration.effects.loads).toBe(1)
    expect(application.diagnostics().lifecycle).toMatchObject({ phase: 'failed' })
    await application.stop()
    expect(configuration.effects.stops).toBe(1)
  })

  it.each(['success', 'failure'] as const)(
    'joins a deferred configuration load with late %s and rejects startup after stop wins',
    async (completion) => {
      const loaded = Promise.withResolvers<ConfigurationRead>()
      const entered = Promise.withResolvers<void>()
      const configuration = configurationFixture()
      const application = createRoadmapApplication({
        configuration: {
          ...configuration.document,
          async load() {
            configuration.effects.loads += 1
            entered.resolve()
            return loaded.promise
          },
        },
        admissions: {},
        observers: noSources(),
      })
      const states: ReadyApplicationState[] = []
      application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
      const starting = outcome(application.start())
      const concurrentStarting = outcome(application.start())
      await entered.promise
      let stopped = false
      const stopping = outcome(application.stop()).then((result) => {
        stopped = true
        return result
      })
      try {
        await setImmediate()
        expect(stopped).toBe(false)
        if (completion === 'failure')
          loaded.reject(new Error('Harmless late configuration load failure.'))
        else loaded.resolve({ ok: true, document: CONFIGURATION })
        expect(await starting).toMatchObject({ ok: false })
        expect(await concurrentStarting).toMatchObject({ ok: false })
        expect(await stopping).toEqual({ ok: true, value: undefined })
        configuration.emit({ ok: true, document: { ...CONFIGURATION, configurationVersion: 2 } })
        application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
        expect(configuration.effects.subscriptions).toBe(0)
        expect(configuration.subscriptions).toBe(0)
        expect(configuration.effects.stops).toBe(1)
        expect(states).toEqual([])
        expect(await outcome(application.start())).toMatchObject({ ok: false })
        expect(application.diagnostics().lifecycle).toEqual({ phase: 'stopped' })
      } finally {
        loaded.resolve({ ok: true, document: CONFIGURATION })
        await Promise.all([starting, concurrentStarting, stopping])
      }
    },
  )

  it('retires a candidate watcher before joining its deferred real Local baseline', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-lifecycle-baseline-')))
    const readEntered = Promise.withResolvers<void>()
    const readGate = Promise.withResolvers<void>()
    const configuration = configurationFixture({
      ok: true,
      document: {
        ...CONFIGURATION,
        projects: [
          {
            ref: { integration: 'local', projectId: 'candidate' },
            connectionId: 'local',
            workspace: { path: root },
          },
        ],
      },
    })
    const watched = new Set<string>()
    const events: string[] = []
    const states: ReadyApplicationState[] = []
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: { local: createLocalProjectAdmission() },
      observers: {
        ...noSources(),
        local(input) {
          return createLocalObserver(input, {
            now: () => 1_000,
            logger: { info() {}, warn() {} },
            watchDirectory(path) {
              watched.add(path)
              events.push('watch-acquired')
              return {
                close() {
                  watched.delete(path)
                  events.push('watch-closed')
                },
              }
            },
            async readProject(project, options) {
              readEntered.resolve()
              await readGate.promise
              return readLocalProject(project, options)
            },
          })
        },
      },
    })
    application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
    let starting: ReturnType<typeof outcome<void>> | undefined
    let stopping: ReturnType<typeof outcome<void>> | undefined
    try {
      await mkdir(join(root, '.wayfinder'))
      starting = outcome(application.start())
      await readEntered.promise
      expect(watched.size).toBe(1)
      let settled = false
      stopping = outcome(application.stop()).then((result) => {
        settled = true
        return result
      })
      const statesAtStop = states.length
      await setImmediate()
      expect(watched.size).toBe(0)
      expect(events).toEqual(['watch-acquired', 'watch-closed'])
      expect(settled).toBe(false)
      readGate.resolve()
      expect(await starting).toMatchObject({ ok: false })
      expect(await stopping).toEqual({ ok: true, value: undefined })
      expect(configuration.subscriptions).toBe(0)
      expect(configuration.effects.disposals).toBe(1)
      expect(states).toHaveLength(statesAtStop)
      expect(application.current()).toMatchObject({ phase: 'stopped', retained: null })
      expect(application.current()).not.toHaveProperty('projects')
      expect(application.diagnostics().lifecycle).toEqual({ phase: 'stopped' })
    } finally {
      readGate.resolve()
      await starting
      await (stopping ?? outcome(application.stop()))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cleans up acquired sources and the configuration subscription when Automation recovery fails', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-lifecycle-failure-')))
    const failure = new Error('Private Automation recovery detail.')
    const watched = new Set<string>()
    const sources: SourceObserver[] = []
    const configuration = configurationFixture({
      ok: true,
      document: {
        ...CONFIGURATION,
        projects: [
          {
            ref: { integration: 'local', projectId: 'partial' },
            connectionId: 'local',
            workspace: { path: root },
          },
        ],
      },
    })
    const database: AutomationDatabaseDocument = {
      async load() {
        throw failure
      },
      async append() {
        throw new Error('Failed recovery must not append Automation evidence.')
      },
    }
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: { local: createLocalProjectAdmission() },
      observers: {
        ...noSources(),
        local(input) {
          const observer = createLocalObserver(input, {
            logger: { info() {}, warn() {} },
            watchDirectory(path) {
              watched.add(path)
              return {
                close() {
                  watched.delete(path)
                },
              }
            },
          })
          sources.push(observer)
          return observer
        },
      },
      automation: { database, launcher: noLaunch },
    })
    try {
      await mkdir(join(root, '.wayfinder'))
      expect(await outcome(application.start())).toEqual({ ok: false, error: failure })
      expect(watched.size).toBe(0)
      expect(configuration.subscriptions).toBe(0)
      expect(configuration.effects.disposals).toBe(1)
      expect(configuration.effects.stops).toBe(1)
      expect(await outcome(application.start())).toMatchObject({ ok: false })
      expect(application.diagnostics().lifecycle).toMatchObject({ phase: 'failed' })
    } finally {
      await outcome(application.stop())
      await Promise.all(sources.map((source) => source.stop()))
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['idle', 'starting', 'stopping'] as const)(
    'rejects new mutations and native selector queries while %s',
    async (phase) => {
      const gate = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const configuration = configurationFixture()
      const selected: string[] = []
      const application = createRoadmapApplication({
        configuration: {
          ...configuration.document,
          async load() {
            if (phase === 'starting') {
              entered.resolve()
              await gate.promise
            }
            return configuration.document.load()
          },
          async stop() {
            if (phase === 'stopping') {
              entered.resolve()
              await gate.promise
            }
            await configuration.document.stop()
          },
        },
        admissions: {},
        observers: noSources(),
        operations: createApplicationOperations({
          host: {
            async execute(operation) {
              if (operation.type !== 'select-workspace')
                throw new Error('A lifecycle rejection must not launch a host action.')
              selected.push('selector-opened')
              return { kind: 'cancelled' }
            },
          },
        }),
      })
      let starting: ReturnType<typeof outcome<void>> | undefined
      let stopping: ReturnType<typeof outcome<void>> | undefined
      try {
        if (phase === 'starting') {
          starting = outcome(application.start())
          await entered.promise
        } else if (phase === 'stopping') {
          await application.start()
          stopping = outcome(application.stop())
          await entered.promise
        }
        expect(
          await application.execute(
            commandSchema.parse({
              type: 'rename-connection',
              connectionId: 'local',
              name: 'Changed',
              expectedConfigurationVersion: phase === 'stopping' ? 1 : 0,
            }),
          ),
        ).toMatchObject({ ok: false, error: { code: 'not-supported' } })
        expect(await application.query({ type: 'select-workspace' })).toMatchObject({
          ok: false,
          error: { code: 'not-supported' },
        })
        expect(configuration.writes).toEqual([])
        expect(selected).toEqual([])
        expect(application.diagnostics().lifecycle).toEqual({ phase })
      } finally {
        gate.resolve()
        await starting
        await (stopping ?? outcome(application.stop()))
      }
    },
  )

  it.each(['selected', 'cancelled', 'failed'] as const)(
    'drains an admitted native selector with an honest %s result',
    async (completion) => {
      const selector = Promise.withResolvers<
        { kind: 'selected'; path: string } | { kind: 'cancelled' }
      >()
      const entered = Promise.withResolvers<void>()
      const configuration = configurationFixture()
      let selections = 0
      const application = createRoadmapApplication({
        configuration: configuration.document,
        admissions: {},
        observers: noSources(),
        operations: createApplicationOperations({
          host: {
            async execute(operation) {
              if (operation.type !== 'select-workspace')
                throw new Error('The selector must not launch a process.')
              selections += 1
              entered.resolve()
              return selector.promise
            },
          },
        }),
      })
      await application.start()
      const query = application.query({ type: 'select-workspace' })
      await entered.promise
      let stopped = false
      const stopping = outcome(application.stop()).then((result) => {
        stopped = true
        return result
      })
      try {
        await setImmediate()
        expect(stopped).toBe(false)
        expect(await application.query({ type: 'select-workspace' })).toMatchObject({
          ok: false,
          error: { code: 'not-supported' },
        })
        expect(selections).toBe(1)
        if (completion === 'failed') selector.reject(new Error('Private native selector detail.'))
        else
          selector.resolve(
            completion === 'selected'
              ? { kind: 'selected', path: '/harmless-selected-folder/' }
              : { kind: 'cancelled' },
          )
        const result = await query
        if (completion === 'selected')
          expect(result).toMatchObject({
            ok: true,
            operation: 'select-workspace',
            subject: { kind: 'none' },
            result: { kind: 'selected', path: '/harmless-selected-folder/' },
          })
        else if (completion === 'cancelled')
          expect(result).toMatchObject({
            ok: true,
            operation: 'select-workspace',
            subject: { kind: 'none' },
            result: { kind: 'cancelled' },
          })
        else expect(result).toMatchObject({ ok: false, error: { code: 'selection-failed' } })
        expect(await stopping).toEqual({ ok: true, value: undefined })
        expect(JSON.stringify(result)).not.toContain('Private native selector detail.')
        expect(application.diagnostics().lifecycle).toEqual({ phase: 'stopped' })
      } finally {
        selector.resolve({ kind: 'cancelled' })
        await query
        await stopping
      }
    },
  )

  it('allows diagnostic selection but inhibits mutations when invalid configuration reaches read-only readiness', async () => {
    const configuration = configurationFixture({
      ok: false,
      issues: [{ path: '$.projects', message: 'Invalid Project configuration.' }],
    })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: {},
      observers: noSources(),
      operations: createApplicationOperations({
        host: {
          async execute(operation) {
            if (operation.type !== 'select-workspace')
              throw new Error('Invalid configuration must not launch a host process.')
            return { kind: 'cancelled' }
          },
        },
      }),
    })
    try {
      await application.start()
      expect(readApplicationState(application.current()).configuration).toMatchObject({
        valid: false,
      })
      expect(await application.query({ type: 'select-workspace' })).toMatchObject({
        ok: true,
        operation: 'select-workspace',
        subject: { kind: 'none' },
        result: { kind: 'cancelled' },
      })
      expect(
        await application.execute(
          commandSchema.parse({
            type: 'rename-connection',
            connectionId: 'local',
            name: 'Changed',
            expectedConfigurationVersion: 0,
          }),
        ),
      ).toMatchObject({ ok: false, error: { code: 'configuration-invalid' } })
      expect(configuration.writes).toEqual([])
      expect(application.diagnostics().lifecycle).toEqual({ phase: 'ready', mode: 'read-only' })
    } finally {
      await application.stop()
    }
  })

  it('reports unknown owner counts until a deferred configuration load produces a committed baseline', async () => {
    const loaded = Promise.withResolvers<ConfigurationRead>()
    const entered = Promise.withResolvers<void>()
    const configuration = configurationFixture()
    const application = createRoadmapApplication({
      configuration: {
        ...configuration.document,
        async load() {
          entered.resolve()
          return loaded.promise
        },
      },
      admissions: {},
      observers: noSources(),
    })
    const starting = outcome(application.start())
    try {
      await entered.promise
      expect(await application.query({ type: 'select-workspace' })).toMatchObject({
        ok: false,
        error: { code: 'not-supported' },
      })
      expect(configuration.subscriptions).toBe(0)
      expect(application.diagnostics()).toMatchObject({
        lifecycle: { phase: 'starting' },
        projects: null,
        maps: null,
        unavailable: null,
        absent: null,
      })
      loaded.resolve({ ok: true, document: CONFIGURATION })
      expect(await starting).toEqual({ ok: true, value: undefined })
      expect(application.diagnostics()).toMatchObject({
        lifecycle: { phase: 'ready', mode: 'mutable' },
        projects: 0,
        maps: 0,
        unavailable: 0,
        absent: 0,
      })
    } finally {
      loaded.resolve({ ok: true, document: CONFIGURATION })
      await starting
      await application.stop()
    }
  })

  it('reaches mutable readiness with honest unavailable source evidence instead of failing process startup', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-lifecycle-unavailable-')))
    const configuration = configurationFixture({
      ok: true,
      document: {
        ...CONFIGURATION,
        projects: [
          {
            ref: { integration: 'local', projectId: 'unavailable' },
            connectionId: 'local',
            workspace: { path: join(root, 'missing') },
          },
        ],
      },
    })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: { local: createLocalProjectAdmission() },
      observers: noSources(),
    })
    try {
      await application.start()
      expect(readApplicationState(application.current()).projects[0]?.resource.kind).toBe(
        'never-observed',
      )
      expect(readApplicationState(application.current()).projects[0]?.maps).toEqual([])
      expect(readApplicationState(application.current()).configuration.valid).toBe(true)
      expect(application.diagnostics()).toMatchObject({
        lifecycle: { phase: 'ready', mode: 'mutable' },
        projects: 1,
        maps: null,
        unavailable: 1,
        absent: 0,
      })
    } finally {
      await application.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retires active and pending Local owners promptly when stop interrupts candidate configuration activation', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-lifecycle-candidate-')))
    const activePath = join(root, 'active')
    const candidatePath = join(root, 'candidate')
    const candidateRead = Promise.withResolvers<void>()
    const candidateGate = Promise.withResolvers<void>()
    const saved: ProjectConfiguration = {
      ...CONFIGURATION,
      projects: [
        {
          ref: { integration: 'local', projectId: 'active' },
          connectionId: 'local',
          workspace: { path: activePath },
        },
      ],
    }
    const configuration = configurationFixture({ ok: true, document: saved })
    const watched = new Set<string>()
    const sources: SourceObserver[] = []
    const application = createRoadmapApplication({
      configuration: configuration.document,
      admissions: { local: createLocalProjectAdmission() },
      observers: {
        ...noSources(),
        local(input) {
          const observer = createLocalObserver(input, {
            logger: { info() {}, warn() {} },
            watchDirectory(path) {
              watched.add(path)
              return {
                close() {
                  watched.delete(path)
                },
              }
            },
            async readProject(project, options) {
              if (project.workspace.path === candidatePath) {
                candidateRead.resolve()
                await candidateGate.promise
              }
              return readLocalProject(project, options)
            },
          })
          sources.push(observer)
          return observer
        },
      },
    })
    const states: ReadyApplicationState[] = []
    application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
    let stopping: ReturnType<typeof outcome<void>> | undefined
    try {
      await Promise.all(
        [activePath, candidatePath].map((path) =>
          mkdir(join(path, '.wayfinder'), { recursive: true }),
        ),
      )
      await application.start()
      expect(
        readApplicationState(application.current()).projects.map(
          (project) => project.ref.projectId,
        ),
      ).toEqual(['active'])
      configuration.emit({
        ok: true,
        document: {
          ...saved,
          configurationVersion: 2,
          projects: [
            ...saved.projects,
            {
              ref: { integration: 'local', projectId: 'candidate' },
              connectionId: 'local',
              workspace: { path: candidatePath },
            },
          ],
        },
      })
      await candidateRead.promise
      expect(watched.size).toBe(2)
      let stopped = false
      stopping = outcome(application.stop()).then((result) => {
        stopped = true
        return result
      })
      const publicationsAtStop = states.length
      await setImmediate()
      expect(watched.size).toBe(0)
      expect(stopped).toBe(false)
      expect(application.diagnostics()).toMatchObject({
        lifecycle: { phase: 'stopping' },
        projects: 1,
        maps: 0,
        unavailable: 0,
        absent: 0,
      })
      candidateGate.resolve()
      expect(await stopping).toEqual({ ok: true, value: undefined })
      expect(configuration.subscriptions).toBe(0)
      expect(readApplicationState(application.current()).configurationVersion).toBe(1)
      expect(
        readApplicationState(application.current()).projects.map(
          (project) => project.ref.projectId,
        ),
      ).toEqual(['active'])
      expect(states).toHaveLength(publicationsAtStop)
      expect(application.diagnostics().lifecycle).toEqual({ phase: 'stopped' })
    } finally {
      candidateGate.resolve()
      await (stopping ?? outcome(application.stop()))
      await Promise.all(sources.map((source) => source.stop()))
      await rm(root, { recursive: true, force: true })
    }
  })
})
