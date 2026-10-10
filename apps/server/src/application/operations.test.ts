import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localProjectRefSchema } from '@roadmap/contracts/identity'
import { commandSchema } from '@roadmap/contracts/operations'
import { describe, expect, it } from 'vitest'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import type { HostExecutor, HostOperation, WorkspaceSelection } from '../host/operations.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type { ProjectAdmission, ProjectConfiguration } from '../projects/registry.ts'
import { readApplicationState } from '../public-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const PROJECT = localProjectRefSchema.parse({ integration: 'local', projectId: 'demo' })

function memoryConfiguration(path?: string) {
  let configuration: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: path ? [{ ref: PROJECT, connectionId: 'local', workspace: { path } }] : [],
    automation: { enabled: false, enabledProjects: [] },
  }
  const listeners = new Set<(read: ConfigurationRead) => void>()
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: configuration }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next) {
      configuration = next
      for (const listener of listeners) listener({ ok: true, document: next })
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {},
  }
  return document
}

function application(options: { host: HostExecutor; path?: string; admission?: ProjectAdmission }) {
  return createRoadmapApplication({
    configuration: memoryConfiguration(options.path),
    admissions: { local: options.admission ?? createLocalProjectAdmission() },
    operations: createApplicationOperations({ host: options.host }),
    observers: {
      local(input) {
        return createLocalObserver(input, {
          reconcileMs: 1_000_000,
          logger: { info() {}, warn() {} },
        })
      },
      github() {
        throw new Error('Unexpected GitHub source')
      },
    },
    serverEpoch: 'public-host-operations-test',
    now: () => 1_000,
  })
}

function launch(operation: 'open-workspace' | 'open-terminal' | 'reveal-source') {
  return commandSchema.parse({
    type: 'launch-project-operation',
    expectedConfigurationVersion: 1,
    operation,
    project: PROJECT,
  })
}

async function workspace(run: (path: string) => Promise<void>) {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-host-operations-')))
  try {
    await run(path)
  } finally {
    await rm(path, { recursive: true, force: true })
  }
}

function recorder() {
  const effects: HostOperation[] = []
  const host: HostExecutor = {
    async execute(operation) {
      effects.push(operation)
      if (operation.type === 'select-workspace') return { kind: 'cancelled' }
      return { kind: 'invoked' }
    },
  }
  return { host, effects }
}

describe('public application host operations', () => {
  it('preserves selected candidate path bytes and reports explicit cancellation', async () => {
    const selections: WorkspaceSelection[] = [
      { kind: 'selected', path: '/selected/ workspace /' },
      { kind: 'cancelled' },
    ]
    const app = application({
      host: {
        async execute(operation) {
          if (operation.type !== 'select-workspace') throw new Error('Unexpected launch')
          const selection = selections.shift()
          if (!selection) throw new Error('Unexpected selector invocation')
          return selection
        },
      },
    })
    try {
      await app.start()
      expect(await app.query({ type: 'select-workspace' })).toMatchObject({
        operation: 'select-workspace',
        subject: { kind: 'none' },
        ok: true,
        result: { kind: 'selected', path: '/selected/ workspace /' },
      })
      expect(await app.query({ type: 'select-workspace' })).toMatchObject({
        operation: 'select-workspace',
        subject: { kind: 'none' },
        ok: true,
        result: { kind: 'cancelled' },
      })
    } finally {
      await app.stop()
    }
  })

  it('separates selector failure from successful cancellation without leaking platform errors', async () => {
    const app = application({
      host: {
        async execute() {
          throw new Error('private platform detail')
        },
      },
    })
    try {
      await app.start()
      const outcome = await app.query({ type: 'select-workspace' })
      expect(outcome).toMatchObject({
        operation: 'select-workspace',
        subject: { kind: 'none' },
        ok: false,
        error: { code: 'selection-failed' },
      })
      expect(JSON.stringify(outcome)).not.toContain('private platform detail')
    } finally {
      await app.stop()
    }
  })

  it('rejects selectors before readiness and after stop without invoking the host', async () => {
    const { host, effects } = recorder()
    const app = application({ host })
    expect(await app.query({ type: 'select-workspace' })).toMatchObject({
      ok: false,
      error: { code: 'not-supported' },
    })
    await app.start()
    await app.stop()
    expect(await app.query({ type: 'select-workspace' })).toMatchObject({
      ok: false,
      error: { code: 'not-supported' },
    })
    expect(effects).toEqual([])
  })

  it('invokes every finite effect with only canonical Project and resolved Workspace facts', async () => {
    await workspace(async (path) => {
      const { host, effects } = recorder()
      const app = application({ host, path })
      try {
        await app.start()
        for (const operation of ['open-workspace', 'open-terminal', 'reveal-source'] as const) {
          const outcome = await app.execute(launch(operation))
          expect(outcome).toMatchObject({
            operation: 'launch-project-operation',
            subject: { kind: 'project', project: PROJECT },
            ok: true,
            result: {
              type: 'launch-project-operation',
              project: PROJECT,
              operation,
              status: 'invoked',
            },
          })
          expect(outcome).not.toHaveProperty('state')
        }
        const canonicalPath = await realpath(path)
        expect(effects).toEqual([
          {
            type: 'open-workspace',
            project: { integration: 'local', projectId: 'demo' },
            workspacePath: canonicalPath,
          },
          {
            type: 'open-terminal',
            project: { integration: 'local', projectId: 'demo' },
            workspacePath: canonicalPath,
          },
          {
            type: 'reveal-source',
            project: { integration: 'local', projectId: 'demo' },
            workspacePath: canonicalPath,
          },
        ])
      } finally {
        await app.stop()
      }
    })
  })

  it('reproves current Workspace availability before a native effect', async () => {
    await workspace(async (path) => {
      const { host, effects } = recorder()
      const app = application({ host, path })
      try {
        await app.start()
        await rm(path, { recursive: true, force: true })
        expect(await app.execute(launch('open-workspace'))).toMatchObject({
          ok: false,
          error: { code: 'admission-failed', field: 'workspace.path' },
        })
        expect(effects).toEqual([])
      } finally {
        await app.stop()
      }
    })
  })

  it('rechecks effect ownership after awaited Workspace reproof', async () => {
    await workspace(async (path) => {
      const { host, effects } = recorder()
      const admitted = createLocalProjectAdmission()
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let defer = false
      const app = application({
        host,
        path,
        admission: {
          ...admitted,
          async revalidate(request, runtime) {
            if (defer) {
              entered.resolve()
              await release.promise
            }
            return admitted.revalidate(request, runtime)
          },
        },
      })
      try {
        await app.start()
        defer = true
        const outcome = app.execute(launch('open-terminal'))
        await entered.promise
        const stopped = app.stop()
        release.resolve()
        expect(await outcome).toMatchObject({ ok: false, error: { code: 'admission-failed' } })
        await stopped
        expect(effects).toEqual([])
      } finally {
        release.resolve()
        await app.stop()
      }
    })
  })

  it('reports only failed invocation when the host cannot open the requested application', async () => {
    await workspace(async (path) => {
      const app = application({
        path,
        host: {
          async execute() {
            throw new Error('private executable failure')
          },
        },
      })
      try {
        await app.start()
        const outcome = await app.execute(launch('reveal-source'))
        expect(outcome).toMatchObject({
          ok: false,
          error: { code: 'launch-failed', field: 'operation' },
        })
        expect(outcome).not.toHaveProperty('result')
        expect(JSON.stringify(outcome)).not.toContain('private executable failure')
      } finally {
        await app.stop()
      }
    })
  })

  it.each([
    { operation: '/bin/sh' },
    { operation: 'open-workspace', executable: '/bin/sh' },
    { operation: 'open-terminal', args: ['-c', 'forged'] },
    { operation: 'reveal-source', workspacePath: '/client/path' },
  ])(
    'rejects client effect authority before the public application receives a command',
    async (forged) => {
      const { host, effects } = recorder()
      const app = application({ host })
      try {
        await app.start()
        expect(
          commandSchema.safeParse({
            type: 'launch-project-operation',
            expectedConfigurationVersion: readApplicationState(app.current()).configurationVersion,
            project: PROJECT,
            ...forged,
          }).success,
        ).toBe(false)
        expect(effects).toEqual([])
      } finally {
        await app.stop()
      }
    },
  )
})
