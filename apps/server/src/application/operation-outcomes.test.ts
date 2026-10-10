import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectionIdSchema, localProjectRefSchema } from '@roadmap/contracts/identity'
import { commandSchema, querySchema } from '@roadmap/contracts/operations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CredentialBundle,
  CredentialVault,
  DeviceAuthorizationPoll,
  GitHubConnectionPort,
} from '../authorization/contracts.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
} from '../configuration/document.ts'
import type { HostExecutor } from '../host/operations.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import { readApplicationState } from '../public-test-fixtures.ts'
import { createRoadmapApplication, type RoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const SERVER_EPOCH = 'operation-outcomes-test-epoch'
const BASE: ProjectConfiguration = {
  schemaVersion: 6,
  configurationVersion: 1,
  connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
  projects: [],
  automation: { enabled: false, enabledProjects: [] },
}
const LOCAL_ID = connectionIdSchema.parse('local')
const CANONICAL_PROJECT = localProjectRefSchema.parse({
  integration: 'local',
  projectId: 'canonical-project',
})
const CREDENTIALS: CredentialBundle = {
  accessToken: 'harmless-operation-access',
  refreshToken: 'harmless-operation-refresh',
  accessTokenExpiresAt: 3_600_000,
  refreshTokenExpiresAt: 30_000_000,
}

function memoryConfiguration(
  initial: ProjectConfiguration = BASE,
  replacement: ConfigurationWrite = { ok: true, durability: 'confirmed' },
) {
  let current = initial
  const writes: ProjectConfiguration[] = []
  const listeners = new Set<(read: ConfigurationRead) => void>()
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: current }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next) {
      if (!replacement.ok) return replacement
      current = next
      writes.push(next)
      for (const listener of listeners) {
        listener({ ok: true, document: next, durability: replacement.durability })
      }
      return replacement
    },
    async stop() {},
  }
  return { document, writes }
}

function selectorHost(select: () => Promise<string | null>): HostExecutor {
  return {
    async execute(operation) {
      if (operation.type !== 'select-workspace') throw new Error('Unexpected host launch')
      const path = await select()
      return path === null ? { kind: 'cancelled' } : { kind: 'selected', path }
    },
  }
}

function localApplication(
  options: {
    configuration?: ReturnType<typeof memoryConfiguration>
    host?: HostExecutor
    now?: () => number
  } = {},
) {
  const configuration = options.configuration ?? memoryConfiguration()
  const application = createRoadmapApplication({
    configuration: configuration.document,
    admissions: { local: createLocalProjectAdmission() },
    operations: createApplicationOperations({
      host: options.host ?? selectorHost(async () => null),
    }),
    observers: {
      local(input) {
        return createLocalObserver(input, {
          reconcileMs: 1_000_000,
          logger: { info() {}, warn() {} },
        })
      },
      github() {
        throw new Error('Unexpected GitHub source observation')
      },
    },
    serverEpoch: SERVER_EPOCH,
    now: options.now ?? (() => 1_000),
  })
  return { application, configuration }
}

function authorizationApplication(
  options: { beginFailures?: number; poll?: DeviceAuthorizationPoll } = {},
) {
  const configuration = memoryConfiguration()
  const records = new Map<string, CredentialBundle>()
  const vault: CredentialVault = {
    async read(connectionId) {
      return records.get(connectionId) ?? null
    },
    async write(connectionId, credentials) {
      records.set(connectionId, credentials)
    },
    async delete(connectionId) {
      records.delete(connectionId)
    },
    async cleanupOrphans(connectionIds) {
      for (const connectionId of records.keys()) {
        if (!connectionIds.has(connectionId)) records.delete(connectionId)
      }
    },
  }
  let attempts = 0
  const github: GitHubConnectionPort = {
    integration: {
      integration: 'github',
      name: 'GitHub',
      connectionKind: 'device-authorization',
      newInstallationUrl: 'https://github.com/apps/roadmap/installations/new',
      installationsUrl: 'https://github.com/settings/installations',
      authorizationsUrl: 'https://github.com/settings/connections/applications/test-client',
    },
    async beginDeviceAuthorization() {
      attempts += 1
      if (attempts <= (options.beginFailures ?? 0)) {
        throw new Error('private device-flow failure detail')
      }
      return {
        deviceCode: 'private-operation-device-code',
        userCode: `CODE-${attempts}`,
        verificationUri: 'https://github.com/login/device',
        expiresAt: 60_000,
        intervalMs: 1,
      }
    },
    async pollDeviceAuthorization() {
      return options.poll ?? { status: 'pending' }
    },
    async identify() {
      return { id: '42', login: 'octocat' }
    },
    async refresh() {
      throw new Error('Unexpected credential refresh')
    },
  }
  const application = createRoadmapApplication({
    configuration: configuration.document,
    admissions: { local: createLocalProjectAdmission() },
    observers: {
      local(input) {
        return createLocalObserver(input, {
          reconcileMs: 1_000_000,
          logger: { info() {}, warn() {} },
        })
      },
      github() {
        throw new Error('Authorization does not register a GitHub Project')
      },
    },
    github,
    credentialVault: vault,
    serverEpoch: SERVER_EPOCH,
    now: () => 0,
  })
  return { application, configuration, records }
}

async function temporaryWorkspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-operation-outcomes-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function readableMap(workspace: string) {
  const directory = join(workspace, '.wayfinder', 'operation-map')
  await mkdir(join(directory, 'tickets'), { recursive: true })
  await writeFile(
    join(directory, 'map.md'),
    '---\ntitle: Canonical operation map\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\nObserve the admitted Workspace.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n',
    'utf8',
  )
}

function register(application: RoadmapApplication, path: string) {
  return application.execute(
    commandSchema.parse({
      type: 'register-project',
      candidate: { integration: 'local', connectionId: LOCAL_ID, workspace: { path } },
      expectedConfigurationVersion: readApplicationState(application.current())
        .configurationVersion,
    }),
  )
}

function beginAuthorization(application: RoadmapApplication) {
  return application.execute(
    commandSchema.parse({
      type: 'begin-github-authorization',
      name: 'Operation account',
      expectedConfigurationVersion: 1,
    }),
  )
}

function operationId(application: RoadmapApplication) {
  const operation = readApplicationState(application.current()).authorizationOperations[0]
  if (!operation) throw new Error('Expected an actual authorization operation')
  return operation.id
}

function expectProducer(
  outcome: unknown,
  application: RoadmapApplication,
  operation: string,
  subject: unknown = { kind: 'none' },
) {
  expect(outcome).toMatchObject({
    operation,
    subject,
    serverEpoch: SERVER_EPOCH,
    stateSequence: application.current().stateSequence,
  })
  expect(outcome).not.toHaveProperty('state')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('public application operation outcomes', () => {
  it('identifies a committed normalized Local Project without matching the submitted Workspace path', async () => {
    await temporaryWorkspace(async (root) => {
      const workspace = join(root, ' canonical-project ')
      await readableMap(workspace)
      const alias = join(root, 'submitted-folder')
      await symlink(workspace, alias, 'dir')
      const submitted = `${alias}/./`
      const canonical = await realpath(workspace)
      const { application, configuration } = localApplication()
      try {
        await application.start()
        const outcome = await register(application, submitted)
        const state = readApplicationState(application.current())
        expect(state.configurationVersion).toBe(2)
        expect(state.projects).toMatchObject([
          {
            ref: CANONICAL_PROJECT,
            connectionId: LOCAL_ID,
            source: { integration: 'local', path: canonical },
            resource: { kind: 'current-readable' },
            maps: [
              expect.objectContaining({
                resource: {
                  kind: 'current-readable',
                  observation: expect.objectContaining({
                    value: expect.objectContaining({ title: 'Canonical operation map' }),
                  }),
                },
              }),
            ],
          },
        ])
        expect(
          state.projects.some(
            (project) => project.integration === 'local' && project.source.path === submitted,
          ),
        ).toBe(false)
        expect(configuration.writes).toMatchObject([
          {
            configurationVersion: 2,
            projects: [
              { ref: CANONICAL_PROJECT, connectionId: LOCAL_ID, workspace: { path: canonical } },
            ],
          },
        ])
        expect(outcome).toMatchObject({
          ok: true,
          result: {
            type: 'register-project',
            project: CANONICAL_PROJECT,
            connectionId: LOCAL_ID,
            workspacePath: canonical,
            configurationVersion: 2,
            commit: 'committed',
          },
        })
        expectProducer(outcome, application, 'register-project', {
          kind: 'registration',
          integration: 'local',
          connectionId: LOCAL_ID,
        })
      } finally {
        await application.stop()
      }
    })
  })

  it('returns the same canonical Project and Workspace after repair through a symlink', async () => {
    await temporaryWorkspace(async (root) => {
      const workspace = join(root, 'canonical-project')
      await readableMap(workspace)
      const canonical = await realpath(workspace)
      const alias = join(root, 'repair-folder')
      await symlink(workspace, alias, 'dir')
      const { application, configuration } = localApplication({
        configuration: memoryConfiguration({
          ...BASE,
          projects: [
            { ref: CANONICAL_PROJECT, connectionId: 'local', workspace: { path: canonical } },
          ],
        }),
      })
      try {
        await application.start()
        const outcome = await application.execute(
          commandSchema.parse({
            type: 'repair-project-workspace',
            project: CANONICAL_PROJECT,
            workspace: { path: `${alias}/.` },
            expectedConfigurationVersion: 1,
          }),
        )
        expect(configuration.writes[0]).toMatchObject({
          configurationVersion: 2,
          projects: [{ ref: CANONICAL_PROJECT, workspace: { path: canonical } }],
        })
        expect(readApplicationState(application.current()).projects[0]).toMatchObject({
          ref: CANONICAL_PROJECT,
          source: { integration: 'local', path: canonical },
          resource: { kind: 'current-readable' },
        })
        expect(outcome).toMatchObject({
          ok: true,
          result: {
            type: 'repair-project-workspace',
            project: CANONICAL_PROJECT,
            workspacePath: canonical,
            configurationVersion: 2,
            commit: 'committed',
          },
        })
        expectProducer(outcome, application, 'repair-project-workspace', {
          kind: 'project',
          project: CANONICAL_PROJECT,
        })
      } finally {
        await application.stop()
      }
    })
  })

  it.each(['rename-project', 'remove-project'] as const)(
    'preserves the canonical Project in %s commit feedback',
    async (type) => {
      await temporaryWorkspace(async (root) => {
        await readableMap(root)
        const canonical = await realpath(root)
        const { application, configuration } = localApplication({
          configuration: memoryConfiguration({
            ...BASE,
            projects: [
              { ref: CANONICAL_PROJECT, connectionId: 'local', workspace: { path: canonical } },
            ],
          }),
        })
        try {
          await application.start()
          const outcome = await application.execute(
            commandSchema.parse({
              type,
              project: CANONICAL_PROJECT,
              ...(type === 'rename-project' ? { name: '  Presentation rename  ' } : {}),
              expectedConfigurationVersion: 1,
            }),
          )
          expect(configuration.writes[0]?.configurationVersion).toBe(2)
          const state = readApplicationState(application.current())
          if (type === 'rename-project') {
            expect(state.projects[0]).toMatchObject({
              ref: CANONICAL_PROJECT,
              name: 'Presentation rename',
              source: { integration: 'local', path: canonical },
            })
          } else {
            expect(state.projects).toEqual([])
            expect(configuration.writes[0]?.projects).toEqual([])
          }
          expect(outcome).toMatchObject({
            ok: true,
            result: {
              type,
              project: CANONICAL_PROJECT,
              configurationVersion: 2,
              commit: 'committed',
            },
          })
          expectProducer(outcome, application, type, {
            kind: 'project',
            project: CANONICAL_PROJECT,
          })
        } finally {
          await application.stop()
        }
      })
    },
  )

  it.each(['rename-connection', 'remove-connection'] as const)(
    'preserves the canonical Connection in %s commit feedback',
    async (type) => {
      const connectionId = connectionIdSchema.parse('work-account')
      const { application, configuration } = localApplication({
        configuration: memoryConfiguration({
          ...BASE,
          connections: [
            ...BASE.connections,
            {
              id: connectionId,
              integration: 'github',
              name: 'Work account',
              builtIn: false,
              githubIdentity: { id: '42', login: 'octocat' },
            },
          ],
        }),
      })
      try {
        await application.start()
        const outcome = await application.execute(
          commandSchema.parse({
            type,
            connectionId,
            ...(type === 'rename-connection' ? { name: '  Renamed account  ' } : {}),
            expectedConfigurationVersion: 1,
          }),
        )
        expect(configuration.writes[0]?.configurationVersion).toBe(2)
        const connections = readApplicationState(application.current()).connections
        if (type === 'rename-connection') {
          expect(connections.find((connection) => connection.id === connectionId)?.name).toBe(
            'Renamed account',
          )
        } else {
          expect(connections.some((connection) => connection.id === connectionId)).toBe(false)
        }
        expect(outcome).toMatchObject({
          ok: true,
          result: {
            type,
            connectionId,
            configurationVersion: 2,
            commit: 'committed',
          },
        })
        expectProducer(outcome, application, type, { kind: 'connection', connectionId })
      } finally {
        await application.stop()
      }
    },
  )

  it('reports canonical registration and the actual replacement version when durability is unconfirmed', async () => {
    await temporaryWorkspace(async (root) => {
      const workspace = join(root, ' canonical-project ')
      await readableMap(workspace)
      const canonical = await realpath(workspace)
      const { application, configuration } = localApplication({
        configuration: memoryConfiguration(BASE, {
          ok: true,
          durability: 'unconfirmed',
          message: 'The replacement completed but its directory sync failed.',
        }),
      })
      try {
        await application.start()
        const outcome = await register(application, `${workspace}/.`)
        const persisted = await configuration.document.load()
        expect(persisted).toMatchObject({
          ok: true,
          document: {
            configurationVersion: 2,
            projects: [{ ref: CANONICAL_PROJECT, workspace: { path: canonical } }],
          },
        })
        expect(readApplicationState(application.current())).toMatchObject({
          configurationVersion: 2,
          projects: [{ ref: CANONICAL_PROJECT, source: { path: canonical } }],
          automation: { availability: { status: 'unavailable' } },
        })
        expect(outcome).toMatchObject({
          ok: true,
          result: {
            type: 'register-project',
            project: CANONICAL_PROJECT,
            connectionId: LOCAL_ID,
            workspacePath: canonical,
            configurationVersion: 2,
            commit: 'committed-unconfirmed',
          },
        })
        expectProducer(outcome, application, 'register-project', {
          kind: 'registration',
          integration: 'local',
          connectionId: LOCAL_ID,
        })
      } finally {
        await application.stop()
      }
    })
  })

  it('does not invent a Project or commit after Local admission fails', async () => {
    await temporaryWorkspace(async (root) => {
      const { application, configuration } = localApplication()
      try {
        await application.start()
        const outcome = await register(application, join(root, 'missing'))
        expect(outcome).toMatchObject({ ok: false, error: { code: 'admission-failed' } })
        expect(outcome).not.toHaveProperty('result')
        expect(configuration.writes).toEqual([])
        expect(readApplicationState(application.current())).toMatchObject({
          configurationVersion: 1,
          projects: [],
        })
        expectProducer(outcome, application, 'register-project', {
          kind: 'registration',
          integration: 'local',
          connectionId: LOCAL_ID,
        })
      } finally {
        await application.stop()
      }
    })
  })

  it.each([' /literal folder/// ', '/trailing-slashes///', '   '])(
    'preserves selected folder bytes for %j',
    async (path) => {
      const { application, configuration } = localApplication({
        host: selectorHost(async () => path),
      })
      try {
        await application.start()
        const before = application.current()
        const outcome = await application.query(querySchema.parse({ type: 'select-workspace' }))
        expect(outcome).toMatchObject({ ok: true, result: { kind: 'selected', path } })
        expectProducer(outcome, application, 'select-workspace')
        expect(application.current()).toEqual(before)
        expect(configuration.writes).toEqual([])
      } finally {
        await application.stop()
      }
    },
  )

  it('returns explicit successful folder cancellation without a selected path', async () => {
    const { application } = localApplication({ host: selectorHost(async () => null) })
    try {
      await application.start()
      const outcome = await application.query(querySchema.parse({ type: 'select-workspace' }))
      expect(outcome).toMatchObject({ ok: true, result: { kind: 'cancelled' } })
      expect(outcome).not.toHaveProperty('result.path')
      expect(outcome).not.toHaveProperty('error')
      expectProducer(outcome, application, 'select-workspace')
    } finally {
      await application.stop()
    }
  })

  it('distinguishes a safe selector failure from folder cancellation', async () => {
    const { application } = localApplication({
      host: selectorHost(async () => {
        throw new Error('private native-selector failure detail')
      }),
    })
    try {
      await application.start()
      const outcome = await application.query(querySchema.parse({ type: 'select-workspace' }))
      expect(outcome).toMatchObject({ ok: false, error: { code: 'selection-failed' } })
      expect(outcome).not.toHaveProperty('result')
      expect(JSON.stringify(outcome)).not.toContain('private native-selector failure detail')
      expectProducer(outcome, application, 'select-workspace')
    } finally {
      await application.stop()
    }
  })

  it('keeps stopped-application selection rejection separate from cancellation and selector failure', async () => {
    let selections = 0
    const { application } = localApplication({
      host: selectorHost(async () => {
        selections += 1
        return null
      }),
    })
    try {
      await application.start()
      await application.stop()
      const outcome = await application.query(querySchema.parse({ type: 'select-workspace' }))
      expect(outcome).toMatchObject({ ok: false, error: { code: 'not-supported' } })
      expect(outcome).not.toHaveProperty('result')
      expect(selections).toBe(0)
      expectProducer(outcome, application, 'select-workspace')
    } finally {
      await application.stop()
    }
  })

  it('returns the actual waiting device phase with its required public payload', async () => {
    vi.useFakeTimers()
    const { application, configuration, records } = authorizationApplication()
    try {
      await application.start()
      const outcome = await beginAuthorization(application)
      const id = operationId(application)
      expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
        id,
        status: 'waiting',
        userCode: 'CODE-1',
      })
      expect(outcome).toMatchObject({
        ok: true,
        result: {
          type: 'begin-github-authorization',
          operationId: id,
          phase: 'waiting',
          verificationUri: 'https://github.com/login/device',
          userCode: 'CODE-1',
          expiresAt: 60_000,
        },
      })
      expect(JSON.stringify(outcome)).not.toContain('private-operation-device-code')
      expect(configuration.writes).toEqual([])
      expect(records.size).toBe(0)
      expectProducer(outcome, application, 'begin-github-authorization')
    } finally {
      await application.stop()
    }
  })

  it('reports failed device-flow creation instead of falsely acknowledging authorization waiting', async () => {
    const { application, configuration, records } = authorizationApplication({ beginFailures: 1 })
    try {
      await application.start()
      const outcome = await beginAuthorization(application)
      const id = operationId(application)
      expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
        id,
        status: 'terminal',
        outcome: 'failed',
      })
      expect(outcome).toMatchObject({
        ok: true,
        result: {
          type: 'begin-github-authorization',
          operationId: id,
          phase: 'failed',
          error: { code: 'authorization-failed' },
        },
      })
      expect(outcome).not.toHaveProperty('result.userCode')
      expect(outcome).not.toHaveProperty('result.verificationUri')
      expect(JSON.stringify(outcome)).not.toContain('private device-flow failure detail')
      expect(configuration.writes).toEqual([])
      expect(records.size).toBe(0)
      expectProducer(outcome, application, 'begin-github-authorization')
    } finally {
      await application.stop()
    }
  })

  it('reports the retried operation failed when its replacement device flow also fails', async () => {
    const { application, configuration } = authorizationApplication({ beginFailures: 2 })
    try {
      await application.start()
      await beginAuthorization(application)
      const id = operationId(application)
      const outcome = await application.execute(
        commandSchema.parse({
          type: 'retry-github-authorization',
          operationId: id,
          expectedConfigurationVersion: 1,
        }),
      )
      expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
        id,
        status: 'terminal',
        outcome: 'failed',
      })
      expect(outcome).toMatchObject({
        ok: true,
        result: {
          type: 'retry-github-authorization',
          operationId: id,
          phase: 'failed',
          error: { code: 'authorization-failed' },
        },
      })
      expect(outcome).not.toHaveProperty('result.userCode')
      expect(configuration.writes).toEqual([])
      expectProducer(outcome, application, 'retry-github-authorization', {
        kind: 'authorization',
        operationId: id,
      })
    } finally {
      await application.stop()
    }
  })

  it('acknowledges actual authorization cancellation without inventing a failure or revocation', async () => {
    vi.useFakeTimers()
    const { application, configuration, records } = authorizationApplication()
    try {
      await application.start()
      await beginAuthorization(application)
      const id = operationId(application)
      const outcome = await application.execute(
        commandSchema.parse({
          type: 'cancel-github-authorization',
          operationId: id,
          expectedConfigurationVersion: 1,
        }),
      )
      expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
        id,
        status: 'terminal',
        outcome: 'cancelled',
      })
      expect(outcome).toMatchObject({
        ok: true,
        result: { type: 'cancel-github-authorization', operationId: id, phase: 'cancelled' },
      })
      expect(outcome).not.toHaveProperty('result.error')
      expect(outcome).not.toHaveProperty('result.connection')
      expect(configuration.writes).toEqual([])
      expect(records.size).toBe(0)
      expectProducer(outcome, application, 'cancel-github-authorization', {
        kind: 'authorization',
        operationId: id,
      })
    } finally {
      await application.stop()
    }
  })

  it.each(['denied', 'expired'] as const)(
    'returns the actual %s phase when cancellation arrives after the provider terminal result',
    async (phase) => {
      vi.useFakeTimers()
      const { application, configuration } = authorizationApplication({ poll: { status: phase } })
      try {
        await application.start()
        await beginAuthorization(application)
        const id = operationId(application)
        await vi.advanceTimersByTimeAsync(1)
        await vi.waitFor(() =>
          expect(
            readApplicationState(application.current()).authorizationOperations[0],
          ).toMatchObject({
            id,
            status: 'terminal',
            outcome: phase,
          }),
        )
        const outcome = await application.execute(
          commandSchema.parse({
            type: 'cancel-github-authorization',
            operationId: id,
            expectedConfigurationVersion: 1,
          }),
        )
        expect(outcome).toMatchObject({
          ok: true,
          result: { type: 'cancel-github-authorization', operationId: id, phase },
        })
        if (phase === 'denied')
          expect(outcome).toHaveProperty('result.error.code', 'authorization-failed')
        else expect(outcome).not.toHaveProperty('result.error')
        expect(configuration.writes).toEqual([])
        expectProducer(outcome, application, 'cancel-github-authorization', {
          kind: 'authorization',
          operationId: id,
        })
      } finally {
        await application.stop()
      }
    },
  )

  it('returns the actual granted Connection and commit when cancellation arrives after grant', async () => {
    vi.useFakeTimers()
    const { application, configuration, records } = authorizationApplication({
      poll: { status: 'granted', credentials: CREDENTIALS },
    })
    try {
      await application.start()
      await beginAuthorization(application)
      const id = operationId(application)
      await vi.advanceTimersByTimeAsync(1)
      await vi.waitFor(() =>
        expect(readApplicationState(application.current()).authorizationOperations[0]?.status).toBe(
          'granted',
        ),
      )
      const granted = readApplicationState(application.current())
      const connection = granted.connections.find((candidate) => candidate.integration === 'github')
      if (!connection) throw new Error('Expected the actual committed GitHub Connection')
      expect(granted.configurationVersion).toBe(2)
      expect(records.get(connection.id)).toEqual(CREDENTIALS)
      const outcome = await application.execute(
        commandSchema.parse({
          type: 'cancel-github-authorization',
          operationId: id,
          expectedConfigurationVersion: 2,
        }),
      )
      expect(outcome).toMatchObject({
        ok: true,
        result: {
          type: 'cancel-github-authorization',
          operationId: id,
          phase: 'granted',
          connection: { connectionId: connection.id, accountId: '42' },
          configurationVersion: 2,
        },
      })
      expect(outcome).not.toHaveProperty('result.error')
      expect(readApplicationState(application.current()).authorizationOperations[0]?.status).toBe(
        'granted',
      )
      expect(records.get(connection.id)).toEqual(CREDENTIALS)
      expect(configuration.writes).toHaveLength(1)
      const serialized = JSON.stringify(outcome)
      expect(serialized).not.toContain(CREDENTIALS.accessToken)
      expect(serialized).not.toContain(CREDENTIALS.refreshToken)
      expect(serialized).not.toContain('private-operation-device-code')
      expectProducer(outcome, application, 'cancel-github-authorization', {
        kind: 'authorization',
        operationId: id,
      })
    } finally {
      await application.stop()
    }
  })
})

describe('observerless manual refresh evidence', () => {
  it('reports the actual reproof time when the same unavailable Workspace remains missing', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-unavailable-refresh-')))
    let now = 1_000
    const configuration = memoryConfiguration({
      ...BASE,
      projects: [
        {
          ref: CANONICAL_PROJECT,
          connectionId: 'local',
          workspace: { path: join(root, 'missing') },
        },
      ],
    })
    const { application } = localApplication({ configuration, now: () => now })
    try {
      await application.start()
      now = 2_000
      const first = await application.execute(
        commandSchema.parse({
          type: 'refresh-project',
          project: CANONICAL_PROJECT,
          expectedConfigurationVersion: 1,
        }),
      )
      expect(first).toMatchObject({
        ok: true,
        result: { attempt: { kind: 'failed', attemptedAt: 2_000 } },
      })
      now = 3_000
      const second = await application.execute(
        commandSchema.parse({
          type: 'refresh-project',
          project: CANONICAL_PROJECT,
          expectedConfigurationVersion: 1,
        }),
      )
      expect(second).toMatchObject({
        ok: true,
        result: { attempt: { kind: 'failed', attemptedAt: 3_000 } },
      })
    } finally {
      await application.stop()
      await rm(root, { recursive: true, force: true })
    }
  })
})
