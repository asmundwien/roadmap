import * as filesystem from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandSchema } from '@roadmap/contracts/operations'
import type { GitHubConnectionIdentity, ReadyApplicationState } from '@roadmap/contracts/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type CredentialBundle,
  type CredentialVault,
  CredentialVaultError,
  type DeviceAuthorizationPoll,
  GitHubConnectionError,
  type GitHubConnectionPort,
} from '../authorization/contracts.ts'
import {
  type ConfigurationDocument,
  type ConfigurationRead,
  type ConfigurationWrite,
  createConfigurationDocument,
  decodeConfigurationDocument,
} from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type { SourceContribution } from '../observation/source.ts'
import type { GitHubProjectIntent, ProjectConfiguration } from '../projects/registry.ts'
import {
  fixtureProjectManagement,
  fixtureProjectRef,
  fixtureResourceRef,
  readApplicationState,
} from '../public-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import { createMacOsCredentialVault, type KeychainPort } from './credential-vault.ts'
import { createApplicationOperations } from './operations.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) }
})

const roots: string[] = []

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

const LOCAL_CONNECTION: ProjectConfiguration['connections'][number] = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}
const BASE_CONFIGURATION: ProjectConfiguration = {
  schemaVersion: 6,
  configurationVersion: 1,
  connections: [LOCAL_CONNECTION],
  projects: [],
  automation: { enabled: false, enabledProjects: [] },
}
const GITHUB_INTENT: GitHubProjectIntent = {
  ref: { integration: 'github', projectId: 'octocat/roadmap' },
  connectionId: 'github-connection',
  locator: { repositoryId: '84', nameWithOwner: 'octocat/roadmap' },
  workspace: { path: '/roadmap' },
}
const CREDENTIALS: CredentialBundle = {
  accessToken: 'access-one',
  refreshToken: 'refresh-one',
  accessTokenExpiresAt: 3_600_000,
  refreshTokenExpiresAt: 30_000_000,
}

function memoryConfiguration(initial: ProjectConfiguration) {
  let current = initial
  const writes: ProjectConfiguration[] = []
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: current }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next): Promise<ConfigurationWrite> {
      writes.push(next)
      current = next
      for (const listener of listeners) listener({ ok: true, document: next })
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {},
  }
  return {
    document,
    writes,
    emit(next: ProjectConfiguration) {
      current = next
      for (const listener of listeners) listener({ ok: true, document: next })
    },
  }
}

function memoryVault(initial: Record<string, CredentialBundle> = {}, failWrite = false) {
  const records = new Map(Object.entries(initial))
  const vault: CredentialVault = {
    async read(connectionId) {
      return records.get(connectionId) ?? null
    },
    async write(connectionId, credentials) {
      if (failWrite) throw new Error('keychain detail must stay private')
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
  return { vault, records }
}

function scriptedGitHub(
  options: {
    polls?: Array<DeviceAuthorizationPoll | Error>
    identityId?: string
    refresh?: CredentialBundle | Error
    beginFailures?: number
    now?: () => number
  } = {},
) {
  const polls = [...(options.polls ?? [{ status: 'granted', credentials: CREDENTIALS }])]
  let authorization = 0
  const port: GitHubConnectionPort = {
    integration: {
      integration: 'github',
      name: 'GitHub',
      connectionKind: 'device-authorization',
      newInstallationUrl: 'https://github.com/apps/roadmap/installations/new',
      installationsUrl: 'https://github.com/settings/installations',
      authorizationsUrl: 'https://github.com/settings/connections/applications/client-id',
    },
    beginDeviceAuthorization: vi.fn(async () => {
      authorization += 1
      if (authorization <= (options.beginFailures ?? 0)) {
        throw new GitHubConnectionError('network', 'GitHub could not be reached.')
      }
      return {
        deviceCode: `private-device-${authorization}`,
        userCode: `CODE-${authorization}`,
        verificationUri: 'https://github.com/login/device',
        expiresAt: (options.now ?? (() => 0))() + 60_000,
        intervalMs: 1,
      }
    }),
    pollDeviceAuthorization: vi.fn(async () => {
      const result = polls.shift() ?? { status: 'pending' as const }
      if (result instanceof Error) throw result
      return result
    }),
    identify: vi.fn(async () => ({ id: options.identityId ?? '42', login: 'octocat' })),
    refresh: vi.fn(async () => {
      if (options.refresh instanceof Error) throw options.refresh
      return options.refresh ?? { ...CREDENTIALS, accessToken: 'access-two' }
    }),
  }
  return port
}

function sourceOptions(
  options: {
    now?: () => number
    providerTokens?: string[]
    concurrentTokenRequests?: boolean
    reconcileMs?: number
    contributions?: SourceContribution[]
  } = {},
) {
  const now = options.now ?? (() => 0)
  const pool = createGitHubObserverPool({
    now,
    reconcileMs: options.reconcileMs ?? 1_000_000,
    logger: { warn() {} },
  })
  return {
    operations: createApplicationOperations({
      host: {
        async execute() {
          throw new Error('Unexpected host interaction in authorization fixture.')
        },
      },
    }),
    admissions: { local: createLocalProjectAdmission(), github: createGitHubProjectAdmission() },
    observers: {
      local: (input: Parameters<typeof createLocalObserver>[0]) =>
        createLocalObserver(input, {
          now,
          reconcileMs: 1_000_000,
          logger: { info() {}, warn() {} },
        }),
      github: (input: Parameters<typeof pool.create>[0]) => {
        const observer = pool.create(input)
        observer.subscribe((contribution) => options.contributions?.push(contribution))
        return observer
      },
      reconcileGitHubTopology: (inputs: Parameters<typeof pool.reconcileTopology>[0]) =>
        pool.reconcileTopology(inputs),
      stop: () => pool.stop(),
    },
    providerRead(accessToken: () => Promise<string>) {
      return {
        async restGet(path: string) {
          const token = options.concurrentTokenRequests
            ? (await Promise.all([accessToken(), accessToken()]))[0]
            : await accessToken()
          options.providerTokens?.push(token)
          if (path === '/repositories/84') return { id: 84, full_name: 'octocat/roadmap' }
          if (path.startsWith('/repos/octocat/roadmap/issues?')) return []
          throw new Error(`Unexpected provider request ${path}`)
        },
        async graphql() {
          throw new Error('Unexpected map request for empty repository')
        },
      }
    },
  }
}

function githubConfiguration(): ProjectConfiguration {
  return {
    ...BASE_CONFIGURATION,
    connections: [
      LOCAL_CONNECTION,
      {
        id: 'github-connection',
        integration: 'github',
        name: 'Personal GitHub',
        builtIn: false,
        githubIdentity: { id: '42', login: 'octocat' },
      },
    ],
  }
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open)
  vi.mocked(filesystem.rename).mockReset().mockImplementation(actual.rename)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('RoadmapApplication GitHub Connections', () => {
  it('does not publish a fabricated failure while initial device authorization is still being acquired', async () => {
    const configuration = memoryConfiguration(BASE_CONFIGURATION)
    const github = scriptedGitHub()
    const entered = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    vi.mocked(github.beginDeviceAuthorization).mockImplementationOnce(async () => {
      entered.resolve()
      await released.promise
      return {
        deviceCode: 'private-held-device',
        userCode: 'ACTUAL-CODE',
        verificationUri: 'https://github.com/login/device',
        expiresAt: 60_000,
        intervalMs: 10_000,
      }
    })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: memoryVault().vault,
      github,
      ...sourceOptions(),
      now: () => 0,
    })
    await application.start()
    const begun = application.execute(
      commandSchema.parse({
        type: 'begin-github-authorization',
        name: 'Pending actual device',
        expectedConfigurationVersion: 1,
      }),
    )
    try {
      await entered.promise
      configuration.emit(BASE_CONFIGURATION)
      expect(readApplicationState(application.current()).authorizationOperations).toEqual([])
      released.resolve()
      const outcome = await begun
      if (
        !outcome.ok ||
        outcome.result.type !== 'begin-github-authorization' ||
        outcome.result.phase !== 'waiting'
      )
        throw new Error('Expected the acquired device authorization.')
      expect(outcome).toMatchObject({
        operation: 'begin-github-authorization',
        subject: { kind: 'none' },
        ok: true,
        result: {
          type: 'begin-github-authorization',
          operationId: outcome.result.operationId,
          phase: 'waiting',
          verificationUri: 'https://github.com/login/device',
          userCode: 'ACTUAL-CODE',
          expiresAt: 60_000,
        },
      })
      expect(readApplicationState(application.current()).authorizationOperations).toMatchObject([
        { id: outcome.result.operationId, status: 'waiting', userCode: 'ACTUAL-CODE' },
      ])
    } finally {
      released.resolve()
      await begun.catch(() => {})
      await application.stop()
    }
  })
  it.each(['command', 'manual'])(
    'terminates waiting reauthorization before its Connection is removed by %s input',
    async (input) => {
      vi.useFakeTimers()
      const initial = githubConfiguration()
      const configuration = memoryConfiguration(initial)
      const credentials = memoryVault({ 'github-connection': CREDENTIALS })
      const github = scriptedGitHub({ polls: [{ status: 'granted', credentials: CREDENTIALS }] })
      const application = createRoadmapApplication({
        configuration: configuration.document,
        credentialVault: credentials.vault,
        github,
        ...sourceOptions(),
        now: () => 0,
      })
      try {
        await application.start()
        const begun = await application.execute(
          commandSchema.parse({
            type: 'reauthorize-github-connection',
            connectionId: 'github-connection',
            expectedConfigurationVersion: 1,
          }),
        )
        if (
          !begun.ok ||
          begun.result.type !== 'reauthorize-github-connection' ||
          begun.result.phase !== 'waiting'
        )
          throw new Error('Expected actual waiting reauthorization.')
        const operationId = begun.result.operationId
        expect(begun).toMatchObject({
          operation: 'reauthorize-github-connection',
          subject: { kind: 'connection', connectionId: 'github-connection' },
          result: {
            type: 'reauthorize-github-connection',
            operationId,
            phase: 'waiting',
            verificationUri: 'https://github.com/login/device',
            userCode: 'CODE-1',
            expiresAt: 60_000,
          },
        })
        expect(
          readApplicationState(application.current()).authorizationOperations[0],
        ).toMatchObject({ id: operationId, status: 'waiting', connectionId: 'github-connection' })
        if (input === 'command') {
          const removed = await application.execute(
            commandSchema.parse({
              type: 'remove-connection',
              connectionId: 'github-connection',
              expectedConfigurationVersion: 1,
            }),
          )
          expect(removed.ok).toBe(true)
        } else {
          configuration.emit({
            ...initial,
            configurationVersion: 2,
            connections: [LOCAL_CONNECTION],
          })
        }
        await vi.waitFor(() =>
          expect(readApplicationState(application.current()).configurationVersion).toBe(2),
        )
        expect(readApplicationState(application.current()).connections).toHaveLength(1)
        expect(
          readApplicationState(application.current()).authorizationOperations[0],
        ).toMatchObject({
          id: operationId,
          status: 'terminal',
          outcome: 'cancelled',
          connectionId: 'github-connection',
        })
        await vi.advanceTimersByTimeAsync(1000)
        expect(github.pollDeviceAuthorization).not.toHaveBeenCalled()
        expect(configuration.writes).toHaveLength(input === 'command' ? 1 : 0)
        const beginCount = vi.mocked(github.beginDeviceAuthorization).mock.calls.length
        const current = readApplicationState(application.current())
        const retried = await application.execute(
          commandSchema.parse({
            type: 'retry-github-authorization',
            operationId,
            expectedConfigurationVersion: current.configurationVersion,
          }),
        )
        expect(retried).toMatchObject({
          ok: false,
          error: { code: 'validation', field: 'connectionId' },
        })
        expect(github.beginDeviceAuthorization).toHaveBeenCalledTimes(beginCount)
      } finally {
        await application.stop()
      }
    },
  )
  it('retains the actual granted account receipt after its Connection is removed', async () => {
    vi.useFakeTimers()
    const configuration = memoryConfiguration(BASE_CONFIGURATION)
    const credentials = memoryVault()
    const github = scriptedGitHub()
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: credentials.vault,
      github,
      ...sourceOptions(),
      now: () => 0,
    })
    try {
      await application.start()
      const begun = await application.execute(
        commandSchema.parse({
          type: 'begin-github-authorization',
          name: 'Historical grant',
          expectedConfigurationVersion: 1,
        }),
      )
      if (
        !begun.ok ||
        begun.result.type !== 'begin-github-authorization' ||
        begun.result.phase !== 'waiting'
      )
        throw new Error('Expected the initial device authorization.')
      expect(begun.result).toEqual({
        type: 'begin-github-authorization',
        operationId: begun.result.operationId,
        phase: 'waiting',
        verificationUri: 'https://github.com/login/device',
        userCode: 'CODE-1',
        expiresAt: 60_000,
      })
      await vi.advanceTimersByTimeAsync(1)
      await vi.waitFor(() =>
        expect(readApplicationState(application.current()).authorizationOperations[0]?.status).toBe(
          'granted',
        ),
      )
      const granted = readApplicationState(application.current())
      const receipt = granted.authorizationOperations[0]
      expect(receipt).toMatchObject({
        status: 'granted',
        connection: { kind: 'current', accountId: '42' },
      })
      if (receipt?.status !== 'granted') throw new Error('Expected actual provider grant.')
      expect(receipt.id).toBe(begun.result.operationId)
      const cancelledAfterGrant = await application.execute(
        commandSchema.parse({
          type: 'cancel-github-authorization',
          operationId: begun.result.operationId,
          expectedConfigurationVersion: granted.configurationVersion,
        }),
      )
      expect(cancelledAfterGrant).toMatchObject({
        operation: 'cancel-github-authorization',
        subject: { kind: 'authorization', operationId: begun.result.operationId },
        ok: true,
        result: {
          type: 'cancel-github-authorization',
          operationId: begun.result.operationId,
          phase: 'granted',
          connection: { connectionId: receipt.connection.id, accountId: '42' },
          configurationVersion: 2,
        },
      })
      const retryGranted = await application.execute(
        commandSchema.parse({
          type: 'retry-github-authorization',
          operationId: begun.result.operationId,
          expectedConfigurationVersion: granted.configurationVersion,
        }),
      )
      expect(retryGranted).toMatchObject({
        operation: 'retry-github-authorization',
        subject: { kind: 'authorization', operationId: begun.result.operationId },
        ok: false,
        error: { code: 'validation', field: 'operationId' },
      })
      expect(github.beginDeviceAuthorization).toHaveBeenCalledOnce()
      expect(configuration.writes).toHaveLength(1)
      expect(credentials.records.get(receipt.connection.id)).toEqual(CREDENTIALS)
      const removed = await application.execute(
        commandSchema.parse({
          type: 'remove-connection',
          connectionId: receipt.connection.id,
          expectedConfigurationVersion: granted.configurationVersion,
        }),
      )
      expect(removed.ok).toBe(true)
      expect(readApplicationState(application.current()).authorizationOperations[0]).toEqual({
        id: receipt.id,
        status: 'granted',
        connection: { kind: 'historical', id: receipt.connection.id, accountId: '42' },
      })
      const cancelledHistoricalGrant = await application.execute(
        commandSchema.parse({
          type: 'cancel-github-authorization',
          operationId: begun.result.operationId,
          expectedConfigurationVersion: 3,
        }),
      )
      expect(cancelledHistoricalGrant).toMatchObject({
        ok: true,
        result: {
          type: 'cancel-github-authorization',
          operationId: begun.result.operationId,
          phase: 'granted',
          connection: { connectionId: receipt.connection.id, accountId: '42' },
          configurationVersion: 2,
        },
      })
      expect(credentials.records.has(receipt.connection.id)).toBe(false)
      expect(configuration.writes).toHaveLength(2)
      expect(github.beginDeviceAuthorization).toHaveBeenCalledOnce()
      await application.stop()
      expect(application.current()).toMatchObject({
        phase: 'stopped',
        retained: {
          authorizationOperations: [
            {
              id: receipt.id,
              status: 'granted',
              connection: { kind: 'historical', id: receipt.connection.id, accountId: '42' },
            },
          ],
        },
      })
    } finally {
      await application.stop()
    }
  })

  it('publishes a safe device operation, then saves identity and credentials before configuration', async () => {
    vi.useFakeTimers()
    const configuration = memoryConfiguration(BASE_CONFIGURATION)
    const credentials = memoryVault()
    const github = scriptedGitHub()
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: credentials.vault,
      github,
      ...sourceOptions(),
      serverEpoch: 'test',
      now: () => 0,
    })
    await application.start()

    const begun = await application.execute(
      commandSchema.parse({
        type: 'begin-github-authorization',
        name: 'Personal GitHub',
        expectedConfigurationVersion: 1,
      }),
    )

    if (
      !begun.ok ||
      begun.result.type !== 'begin-github-authorization' ||
      begun.result.phase !== 'waiting'
    )
      throw new Error('Expected actual waiting authorization.')
    expect(begun).toMatchObject({
      operation: 'begin-github-authorization',
      subject: { kind: 'none' },
      ok: true,
      result: {
        type: 'begin-github-authorization',
        operationId: begun.result.operationId,
        phase: 'waiting',
        verificationUri: 'https://github.com/login/device',
        userCode: 'CODE-1',
        expiresAt: 60_000,
      },
    })
    expect(begun).not.toHaveProperty('state')
    expect(JSON.stringify(begun)).not.toContain('private-device')
    expect(JSON.stringify(begun)).not.toContain('access-one')
    expect(readApplicationState(application.current()).supportedIntegrations).toContainEqual(
      github.integration,
    )
    expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
      id: begun.result.operationId,
      status: 'waiting',
      verificationUri: 'https://github.com/login/device',
      userCode: 'CODE-1',
      expiresAt: 60_000,
    })
    expect(JSON.stringify(readApplicationState(application.current()))).not.toContain(
      'private-device',
    )
    expect(JSON.stringify(readApplicationState(application.current()))).not.toContain('access-one')

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
        status: 'granted',
      }),
    )
    expect(readApplicationState(application.current()).connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          integration: 'github',
          githubIdentity: { id: '42', login: 'octocat' },
        }),
      ]),
    )
    const saved = configuration.writes[0]?.connections.find(
      (connection) => connection.integration === 'github',
    )
    expect(saved?.githubIdentity).toEqual({ id: '42', login: 'octocat' })
    expect(credentials.records.get(saved?.id ?? '')).toEqual(CREDENTIALS)
    expect(JSON.stringify(configuration.writes)).not.toContain('access-one')
    expect(
      readApplicationState(application.current()).connections.find(
        (connection) => connection.integration === 'github',
      )?.availability.observedAt,
    ).toBeUndefined()
    await application.stop()
  })

  it.each([false, true])(
    'waits for vault persistence before committing a new Connection, vault rejection=%s',
    async (rejectVault) => {
      vi.useFakeTimers()
      const configuration = memoryConfiguration(BASE_CONFIGURATION)
      const credentials = memoryVault()
      const gate = deferred<void>()
      const entered = deferred<void>()
      const vault: CredentialVault = {
        ...credentials.vault,
        async write(id, bundle) {
          entered.resolve()
          await gate.promise
          await credentials.vault.write(id, bundle)
        },
      }
      const application = createRoadmapApplication({
        configuration: configuration.document,
        credentialVault: vault,
        github: scriptedGitHub(),
        ...sourceOptions(),
        now: () => 0,
      })
      try {
        await application.start()
        await application.execute(
          commandSchema.parse({
            type: 'begin-github-authorization',
            name: 'Personal GitHub',
            expectedConfigurationVersion: 1,
          }),
        )
        await vi.advanceTimersByTimeAsync(1)
        await entered.promise

        expect(configuration.writes).toEqual([])
        expect(readApplicationState(application.current()).configurationVersion).toBe(1)
        expect(readApplicationState(application.current()).connections).toHaveLength(1)
        expect(readApplicationState(application.current()).authorizationOperations[0]?.status).toBe(
          'waiting',
        )
        expect(credentials.records.size).toBe(0)

        if (rejectVault) gate.reject(new Error('private vault failure'))
        else gate.resolve()
        await vi.waitFor(() =>
          expect(
            readApplicationState(application.current()).authorizationOperations[0],
          ).toMatchObject(
            rejectVault ? { status: 'terminal', outcome: 'failed' } : { status: 'granted' },
          ),
        )
        expect(configuration.writes).toHaveLength(rejectVault ? 0 : 1)
        expect(readApplicationState(application.current()).connections).toHaveLength(
          rejectVault ? 1 : 2,
        )
        expect(credentials.records.size).toBe(rejectVault ? 0 : 1)
        expect(JSON.stringify(readApplicationState(application.current()))).not.toContain(
          'private vault failure',
        )
      } finally {
        gate.resolve()
        await application.stop()
      }
    },
  )

  it.each([
    { reauthorizing: false, failure: 'rename' },
    { reauthorizing: true, failure: 'rename' },
    { reauthorizing: false, failure: 'directory-sync' },
    { reauthorizing: true, failure: 'directory-sync' },
    { reauthorizing: false, failure: 'directory-close' },
  ] as const)(
    'preserves credential/configuration truth for $failure, reauthorization=$reauthorizing',
    async ({ reauthorizing, failure }) => {
      vi.useFakeTimers()
      const root = await mkdtemp(join(tmpdir(), 'roadmap-authorization-persistence-'))
      roots.push(root)
      const path = join(root, 'roadmap.config.json')
      const project = GITHUB_INTENT
      const initial = reauthorizing
        ? { ...githubConfiguration(), projects: [project] }
        : BASE_CONFIGURATION
      await writeFile(path, `${JSON.stringify(initial, null, 2)}\n`, 'utf8')
      const configuration = createConfigurationDocument(path, { debounceMs: 60_000 })
      const renewed = {
        ...CREDENTIALS,
        accessToken: 'access-renewed',
        refreshToken: 'refresh-renewed',
      }
      const credentials = memoryVault(reauthorizing ? { 'github-connection': CREDENTIALS } : {})
      const application = createRoadmapApplication({
        configuration,
        credentialVault: credentials.vault,
        github: scriptedGitHub({ polls: [{ status: 'granted', credentials: renewed }] }),
        ...sourceOptions(),
        now: () => 0,
      })
      const states: ReturnType<typeof application.current>[] = []
      application.subscribe((state) => states.push(readApplicationState(state)))
      try {
        await application.start()
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        if (failure === 'rename') {
          vi.mocked(filesystem.rename).mockRejectedValueOnce(new Error('private rename detail'))
        } else {
          vi.mocked(filesystem.open).mockImplementation(async (file, flags, mode) => {
            const handle = await actual.open(file, flags, mode)
            if (file === root && failure === 'directory-sync') {
              vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('private sync detail'))
            }
            if (file === root && failure === 'directory-close') {
              const close = handle.close.bind(handle)
              vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
                await close()
                throw new Error('private close detail')
              })
            }
            return handle
          })
        }
        const begun = await application.execute(
          commandSchema.parse({
            ...(reauthorizing
              ? { type: 'reauthorize-github-connection', connectionId: 'github-connection' }
              : { type: 'begin-github-authorization', name: 'Personal GitHub' }),
            expectedConfigurationVersion: 1,
          }),
        )
        if (
          !begun.ok ||
          (begun.result.type !== 'begin-github-authorization' &&
            begun.result.type !== 'reauthorize-github-connection') ||
          begun.result.phase !== 'waiting'
        )
          throw new Error('Expected the actual device authorization before grant persistence.')
        expect(begun.result).toMatchObject({
          operationId: begun.result.operationId,
          phase: 'waiting',
          verificationUri: 'https://github.com/login/device',
          userCode: 'CODE-1',
          expiresAt: 60_000,
        })
        await vi.advanceTimersByTimeAsync(1)
        await vi.waitFor(() =>
          expect(
            readApplicationState(application.current()).authorizationOperations[0]?.status,
          ).not.toBe('waiting'),
        )

        const stored = decodeConfigurationDocument(JSON.parse(await readFile(path, 'utf8')))
        if (!stored.ok) throw new Error('Expected valid committed configuration')
        const committed = failure !== 'rename'
        expect(stored.value.configurationVersion).toBe(committed ? 2 : 1)
        expect(readApplicationState(application.current()).configurationVersion).toBe(
          committed ? 2 : 1,
        )
        expect(stored.value.projects).toMatchObject(initial.projects)
        expect(readApplicationState(application.current()).projects).toMatchObject(
          reauthorizing ? [fixtureProjectManagement(GITHUB_INTENT)] : [],
        )
        expect(
          readApplicationState(application.current()).authorizationOperations[0],
        ).toMatchObject(
          failure === 'directory-close'
            ? { status: 'granted' }
            : { status: 'terminal', outcome: 'failed' },
        )
        const terminal = await application.execute(
          commandSchema.parse({
            type: 'cancel-github-authorization',
            operationId: begun.result.operationId,
            expectedConfigurationVersion: committed ? 2 : 1,
          }),
        )
        expect(terminal).toMatchObject({
          operation: 'cancel-github-authorization',
          subject: { kind: 'authorization', operationId: begun.result.operationId },
          ok: true,
          result: {
            type: 'cancel-github-authorization',
            operationId: begun.result.operationId,
            phase: failure === 'directory-close' ? 'granted' : 'failed',
          },
        })
        if (!terminal.ok || terminal.result.type !== 'cancel-github-authorization')
          throw new Error('Expected actual authorization settlement.')
        if (failure === 'directory-close') {
          const connection = stored.value.connections.find((item) => item.integration === 'github')
          if (!connection) throw new Error('Expected the committed granted Connection.')
          expect(terminal.result).toMatchObject({
            phase: 'granted',
            connection: { connectionId: connection.id, accountId: '42' },
            configurationVersion: 2,
          })
        } else {
          expect(terminal.result).toMatchObject({
            phase: 'failed',
            error: { code: 'authorization-failed', message: expect.any(String) },
          })
          expect(terminal.result).not.toHaveProperty('connection')
          expect(terminal.result).not.toHaveProperty('configurationVersion')
        }
        if (failure === 'directory-sync') {
          expect(readApplicationState(application.current()).automation.availability).toMatchObject(
            {
              status: 'unavailable',
            },
          )
        }
        if (reauthorizing || committed) {
          const connection = stored.value.connections.find((item) => item.integration === 'github')
          if (!connection) throw new Error('Expected retained configured GitHub identity')
          expect(connection.githubIdentity).toEqual({ id: '42', login: 'octocat' })
          expect(credentials.records.get(connection.id)).toEqual(renewed)
          expect(readApplicationState(application.current()).connections).toContainEqual(
            expect.objectContaining({
              id: connection.id,
              githubIdentity: connection.githubIdentity,
            }),
          )
        } else {
          expect(stored.value).toEqual(initial)
          expect(credentials.records.size).toBe(0)
          expect(readApplicationState(application.current()).connections).toHaveLength(1)
        }
        const publicAndDisk = JSON.stringify({
          states,
          current: readApplicationState(application.current()),
          stored: stored.value,
          terminal,
        })
        expect(publicAndDisk).not.toContain('access-renewed')
        expect(publicAndDisk).not.toContain('refresh-renewed')
        expect(publicAndDisk).not.toContain('private-device')
      } finally {
        await application.stop()
      }
    },
  )

  it.each([false, true])(
    'does not expose a refreshed token to observation before vault persistence, rejection=%s',
    async (rejectVault) => {
      const credentials = memoryVault({
        'github-connection': { ...CREDENTIALS, accessTokenExpiresAt: 1 },
      })
      const entered = deferred<void>()
      const gate = deferred<void>()
      const providerTokens: string[] = []
      const vault: CredentialVault = {
        ...credentials.vault,
        async write(id, bundle) {
          entered.resolve()
          await gate.promise
          await credentials.vault.write(id, bundle)
        },
      }
      const application = createRoadmapApplication({
        configuration: memoryConfiguration({ ...githubConfiguration(), projects: [GITHUB_INTENT] })
          .document,
        credentialVault: vault,
        github: scriptedGitHub(),
        ...sourceOptions({ providerTokens }),
        now: () => 0,
      })
      const starting = application.start()
      try {
        await entered.promise
        expect(providerTokens).toEqual([])
        expect(credentials.records.get('github-connection')?.accessToken).toBe('access-one')

        if (rejectVault) gate.reject(new Error('private refreshed credential detail'))
        else gate.resolve()
        await starting

        expect(providerTokens).toEqual(rejectVault ? [] : ['access-two', 'access-two'])
        expect(credentials.records.get('github-connection')?.accessToken).toBe(
          rejectVault ? 'access-one' : 'access-two',
        )
        expect(
          readApplicationState(application.current()).connections[1]?.availability.status,
        ).toBe(rejectVault ? 'authorization-required' : 'available')
        const connection = readApplicationState(application.current()).connections[1]
        if (connection?.integration !== 'github') {
          throw new Error('Expected retained GitHub Connection identity')
        }
        expect(connection.githubIdentity).toEqual({
          id: '42',
          login: 'octocat',
        })
        expect(JSON.stringify(readApplicationState(application.current()))).not.toContain(
          'access-two',
        )
        expect(JSON.stringify(readApplicationState(application.current()))).not.toContain(
          'private refreshed credential detail',
        )
      } finally {
        gate.resolve()
        await starting
        await application.stop()
      }
    },
  )

  it('cancels, retries, honors slow_down, and records denial without polling after cancellation', async () => {
    vi.useFakeTimers()
    const configuration = memoryConfiguration(BASE_CONFIGURATION)
    const github = scriptedGitHub({ polls: [{ status: 'denied' }] })
    let firstPollAt: number | undefined
    vi.mocked(github.pollDeviceAuthorization).mockImplementationOnce(async () => {
      firstPollAt = Date.now()
      return { status: 'slow-down' }
    })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: memoryVault().vault,
      github,
      ...sourceOptions(),
      now: () => 0,
    })
    await application.start()
    const begun = await application.execute(
      commandSchema.parse({
        type: 'begin-github-authorization',
        name: 'Personal GitHub',
        expectedConfigurationVersion: 1,
      }),
    )
    if (
      !begun.ok ||
      begun.result.type !== 'begin-github-authorization' ||
      begun.result.phase !== 'waiting'
    )
      throw new Error('Expected actual waiting authorization.')
    const operationId = begun.result.operationId
    expect(begun.result).toEqual({
      type: 'begin-github-authorization',
      operationId,
      phase: 'waiting',
      verificationUri: 'https://github.com/login/device',
      userCode: 'CODE-1',
      expiresAt: 60_000,
    })

    const cancelled = await application.execute(
      commandSchema.parse({
        type: 'cancel-github-authorization',
        operationId,
        expectedConfigurationVersion: 1,
      }),
    )
    expect(cancelled).toMatchObject({
      operation: 'cancel-github-authorization',
      subject: { kind: 'authorization', operationId },
      ok: true,
      result: { type: 'cancel-github-authorization', operationId, phase: 'cancelled' },
    })
    if (!cancelled.ok) throw new Error('Expected actual cancellation.')
    expect(cancelled.result).toEqual({
      type: 'cancel-github-authorization',
      operationId,
      phase: 'cancelled',
    })
    const cancelledAgain = await application.execute(
      commandSchema.parse({
        type: 'cancel-github-authorization',
        operationId,
        expectedConfigurationVersion: 1,
      }),
    )
    expect(cancelledAgain).toMatchObject({
      ok: true,
      result: { type: 'cancel-github-authorization', operationId, phase: 'cancelled' },
    })
    expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
      id: operationId,
      status: 'terminal',
      outcome: 'cancelled',
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(github.pollDeviceAuthorization).not.toHaveBeenCalled()

    const retried = await application.execute(
      commandSchema.parse({
        type: 'retry-github-authorization',
        operationId,
        expectedConfigurationVersion: 1,
      }),
    )
    expect(retried).toMatchObject({
      operation: 'retry-github-authorization',
      subject: { kind: 'authorization', operationId },
      ok: true,
      result: {
        type: 'retry-github-authorization',
        operationId,
        phase: 'waiting',
        verificationUri: 'https://github.com/login/device',
        userCode: 'CODE-2',
        expiresAt: 60_000,
      },
    })
    await vi.waitFor(() =>
      expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
        id: operationId,
        status: 'waiting',
        userCode: 'CODE-2',
      }),
    )
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(github.pollDeviceAuthorization).toHaveBeenCalledTimes(1), {
      interval: 1,
    })
    if (firstPollAt === undefined) throw new Error('The retried authorization has not polled.')
    await vi.advanceTimersByTimeAsync(Math.max(0, firstPollAt + 5_000 - Date.now()))
    expect(github.pollDeviceAuthorization).toHaveBeenCalledTimes(1)
    expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
      id: operationId,
      status: 'waiting',
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(
      () => {
        expect(github.pollDeviceAuthorization).toHaveBeenCalledTimes(2)
        expect(
          readApplicationState(application.current()).authorizationOperations[0],
        ).toMatchObject({
          id: operationId,
          status: 'terminal',
          outcome: 'denied',
        })
      },
      { interval: 1 },
    )
    const cancelledAfterDenial = await application.execute(
      commandSchema.parse({
        type: 'cancel-github-authorization',
        operationId,
        expectedConfigurationVersion: 1,
      }),
    )
    expect(cancelledAfterDenial).toMatchObject({
      ok: true,
      result: {
        type: 'cancel-github-authorization',
        operationId,
        phase: 'denied',
        error: { code: 'authorization-failed', message: expect.any(String) },
      },
    })
    expect(github.pollDeviceAuthorization).toHaveBeenCalledTimes(2)
    expect(configuration.writes).toEqual([])
    await application.stop()
  })

  it('reauthenticates a Connection without changing dependent Project registrations', async () => {
    vi.useFakeTimers()
    const project = GITHUB_INTENT
    const existing = { ...githubConfiguration(), projects: [project] }
    const renewed = {
      ...CREDENTIALS,
      accessToken: 'access-renewed',
      refreshToken: 'refresh-renewed',
    }
    const credentials = memoryVault({ 'github-connection': CREDENTIALS })
    const configuration = memoryConfiguration(existing)
    const providerTokens: string[] = []
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: credentials.vault,
      github: scriptedGitHub({ polls: [{ status: 'granted', credentials: renewed }] }),
      ...sourceOptions({ providerTokens }),
      now: () => 0,
    })
    await application.start()
    providerTokens.length = 0

    const begun = await application.execute(
      commandSchema.parse({
        type: 'reauthorize-github-connection',
        connectionId: 'github-connection',
        expectedConfigurationVersion: 1,
      }),
    )
    if (
      !begun.ok ||
      begun.result.type !== 'reauthorize-github-connection' ||
      begun.result.phase !== 'waiting'
    )
      throw new Error('Expected actual waiting reauthorization.')
    const operationId = begun.result.operationId
    expect(begun).toMatchObject({
      operation: 'reauthorize-github-connection',
      subject: { kind: 'connection', connectionId: 'github-connection' },
      result: {
        type: 'reauthorize-github-connection',
        operationId,
        phase: 'waiting',
        verificationUri: 'https://github.com/login/device',
        userCode: 'CODE-1',
        expiresAt: 60_000,
      },
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(readApplicationState(application.current()).authorizationOperations).toContainEqual({
        id: operationId,
        connection: { kind: 'current', id: 'github-connection', accountId: '42' },
        status: 'granted',
      }),
    )
    expect(configuration.writes).toHaveLength(1)
    expect(configuration.writes[0]?.projects).toMatchObject([project])
    expect(configuration.writes[0]?.connections).toHaveLength(existing.connections.length)
    expect(readApplicationState(application.current()).projects).toMatchObject([
      fixtureProjectManagement(GITHUB_INTENT),
    ])
    expect(credentials.records.get('github-connection')).toEqual(renewed)
    providerTokens.length = 0
    expect(
      await application.execute(
        commandSchema.parse({
          type: 'refresh-project',
          project: fixtureProjectRef(fixtureProjectManagement(GITHUB_INTENT).ref),
          expectedConfigurationVersion: readApplicationState(application.current())
            .configurationVersion,
        }),
      ),
    ).toMatchObject({
      ok: true,
      result: {
        type: 'refresh-project',
        project: fixtureProjectManagement(GITHUB_INTENT).ref,
        attempt: {
          kind: 'observed',
          attemptedAt: 0,
          observedAt: 0,
          provenance: {
            integration: 'github',
            connectionId: 'github-connection',
            repositoryId: '84',
            stage: 'repository',
          },
        },
      },
    })
    expect(providerTokens.length).toBeGreaterThan(0)
    expect(providerTokens.every((token) => token === 'access-renewed')).toBe(true)
    expect(readApplicationState(application.current()).projects[0]).toMatchObject({
      resource: { kind: 'current-readable', observation: { observedAt: 0 } },
      mapsMembership: { kind: 'current-complete' },
    })
    await application.stop()
  })

  it('rejects duplicate users, identity-changing reauthorization, and failed vault writes', async () => {
    vi.useFakeTimers()
    const existing = githubConfiguration()
    const credentials = memoryVault({ 'github-connection': CREDENTIALS })
    const github = scriptedGitHub()
    const configuration = memoryConfiguration(existing)
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: credentials.vault,
      github,
      ...sourceOptions(),
      now: () => 0,
    })
    await application.start()

    await application.execute(
      commandSchema.parse({
        type: 'begin-github-authorization',
        name: 'Duplicate',
        expectedConfigurationVersion: 1,
      }),
    )
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
        status: 'terminal',
        outcome: 'failed',
        cause: 'GitHub user octocat already has a Connection.',
      }),
    )
    expect(configuration.writes).toEqual([])
    await application.stop()

    const mismatchedGitHub = scriptedGitHub({ identityId: '99' })
    const second = createRoadmapApplication({
      configuration: memoryConfiguration(existing).document,
      credentialVault: credentials.vault,
      github: mismatchedGitHub,
      ...sourceOptions(),
      now: () => 0,
    })
    await second.start()
    await second.execute(
      commandSchema.parse({
        type: 'reauthorize-github-connection',
        connectionId: 'github-connection',
        expectedConfigurationVersion: 1,
      }),
    )
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(readApplicationState(second.current()).authorizationOperations[0]).toMatchObject({
        status: 'terminal',
        outcome: 'failed',
      }),
    )
    expect(credentials.records.get('github-connection')).toEqual(CREDENTIALS)
    await second.stop()

    const failedVault = memoryVault({}, true)
    const third = createRoadmapApplication({
      configuration: memoryConfiguration(BASE_CONFIGURATION).document,
      credentialVault: failedVault.vault,
      github: scriptedGitHub(),
      ...sourceOptions(),
      now: () => 0,
    })
    await third.start()
    await third.execute(
      commandSchema.parse({
        type: 'begin-github-authorization',
        name: 'Cannot save',
        expectedConfigurationVersion: 1,
      }),
    )
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(readApplicationState(third.current()).authorizationOperations[0]).toMatchObject({
        status: 'terminal',
        outcome: 'failed',
        cause: 'GitHub authorization could not be saved.',
      }),
    )
    expect(readApplicationState(third.current()).connections).toHaveLength(1)
    await third.stop()
  })

  it.each([
    {
      name: 'keeps same-account reauthorization usable after an obsolete rejected autonomous refresh',
      outcome: 'rejected',
      holdReplacementWrite: false,
    },
    {
      name: 'keeps same-account reauthorization usable after an obsolete successful autonomous refresh',
      outcome: 'successful',
      holdReplacementWrite: false,
    },
    {
      name: 'keeps same-account reauthorization usable when its vault write precedes an obsolete refresh commit',
      outcome: 'successful',
      holdReplacementWrite: true,
    },
  ] as const)('$name', async ({ outcome, holdReplacementWrite }) => {
    vi.useFakeTimers()
    let clock = 0
    const expiring = { ...CREDENTIALS, accessTokenExpiresAt: 600_001 }
    const replacement: CredentialBundle = {
      ...CREDENTIALS,
      accessToken: 'harmless-replacement-access',
      refreshToken: 'harmless-replacement-refresh',
    }
    const obsolete: CredentialBundle = {
      ...CREDENTIALS,
      accessToken: 'harmless-obsolete-access',
      refreshToken: 'harmless-obsolete-refresh',
    }
    const replacementWriteEntered = deferred<void>()
    const replacementWriteResult = deferred<void>()
    const keychainRecords = new Map<string, string>()
    const keychain: KeychainPort = {
      async read(service, account) {
        return keychainRecords.get(`${service}:${account}`) ?? null
      },
      async write(service, account, value) {
        if (
          holdReplacementWrite &&
          account === 'github-connection' &&
          value === JSON.stringify(replacement)
        ) {
          replacementWriteEntered.resolve()
          await replacementWriteResult.promise
        }
        keychainRecords.set(`${service}:${account}`, value)
      },
      async delete(service, account) {
        keychainRecords.delete(`${service}:${account}`)
      },
    }
    const credentialVault = createMacOsCredentialVault({
      keychain,
      service: 'harmless-refresh-order',
    })
    await credentialVault.write('github-connection', expiring)
    const configuration = memoryConfiguration({
      ...githubConfiguration(),
      projects: [GITHUB_INTENT],
    })
    const refreshEntered = deferred<void>()
    const refreshResult = deferred<CredentialBundle>()
    const refreshIdentified = deferred<void>()
    const refreshRequests: string[] = []
    const github: GitHubConnectionPort = {
      ...scriptedGitHub({
        now: () => clock,
        polls: [{ status: 'granted', credentials: replacement }],
      }),
      async refresh(refreshToken) {
        refreshRequests.push(refreshToken)
        refreshEntered.resolve()
        return refreshResult.promise
      },
      async identify(accessToken) {
        if (accessToken === obsolete.accessToken) refreshIdentified.resolve()
        return { id: '42', login: 'octocat' }
      },
    }
    const providerTokens: string[] = []
    const contributions: SourceContribution[] = []
    const source = sourceOptions({
      now: () => clock,
      reconcileMs: 1_000,
      providerTokens,
      contributions,
    })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault,
      github,
      ...source,
      admissions: {
        ...source.admissions,
        github: createGitHubProjectAdmission({
          async inspectWorkspace() {
            throw new Error('Harmless unavailable worktree')
          },
        }),
      },
      now: () => clock,
    })
    const states: ReadyApplicationState[] = []
    const unsubscribe = application.subscribe((state) => states.push(readApplicationState(state)))
    try {
      await application.start()
      expect(readApplicationState(application.current()).projects[0]).toMatchObject({
        resource: { kind: 'current-readable', observation: { observedAt: 0 } },
        mapsMembership: { kind: 'current-complete' },
      })
      providerTokens.length = 0
      const baselineContributions = contributions.length

      // The observer's own cadence runs outside the application's mutation lane.
      clock = 600_002
      await vi.advanceTimersByTimeAsync(1_000)
      await refreshEntered.promise
      expect(refreshRequests).toEqual(['refresh-one'])
      expect(providerTokens).toEqual([])
      expect(contributions).toHaveLength(baselineContributions)

      const begun = await application.execute(
        commandSchema.parse({
          type: 'reauthorize-github-connection',
          connectionId: 'github-connection',
          expectedConfigurationVersion: 1,
        }),
      )
      if (
        !begun.ok ||
        begun.result.type !== 'reauthorize-github-connection' ||
        begun.result.phase !== 'waiting'
      )
        throw new Error('Expected actual waiting replacement authorization.')
      const operationId = begun.result.operationId
      expect(begun.result).toEqual({
        type: 'reauthorize-github-connection',
        operationId,
        phase: 'waiting',
        verificationUri: 'https://github.com/login/device',
        userCode: 'CODE-1',
        expiresAt: 660_002,
      })
      await vi.advanceTimersByTimeAsync(1)
      if (holdReplacementWrite) {
        await replacementWriteEntered.promise
        expect(configuration.writes).toEqual([])
        expect(readApplicationState(application.current()).configurationVersion).toBe(1)
        expect(readApplicationState(application.current()).authorizationOperations[0]?.status).toBe(
          'waiting',
        )
        expect(readApplicationState(application.current()).projects[0]?.resource).toMatchObject({
          kind: 'current-readable',
          observation: { observedAt: 0 },
        })
        expect(
          readApplicationState(application.current()).connections[1]?.availability.observedAt,
        ).toBe(0)
        expect(keychainRecords.get('harmless-refresh-order:github-connection')).toBe(
          JSON.stringify(expiring),
        )

        // B owns the pending vault write before A can request its refresh commit.
        clock = 600_003
        refreshResult.resolve(obsolete)
        await refreshIdentified.promise
        await vi.advanceTimersByTimeAsync(0)
        expect(providerTokens).toEqual([])
        replacementWriteResult.resolve()
      }
      await vi.waitFor(() =>
        expect(readApplicationState(application.current()).authorizationOperations).toContainEqual({
          id: operationId,
          connection: { kind: 'current', id: 'github-connection', accountId: '42' },
          status: 'granted',
        }),
      )
      if (!holdReplacementWrite)
        expect(await credentialVault.read('github-connection')).toEqual(replacement)
      expect(readApplicationState(application.current()).configurationVersion).toBe(2)
      if (!holdReplacementWrite) {
        expect(readApplicationState(application.current()).projects[0]?.resource).toMatchObject({
          kind: 'current-readable',
          observation: { observedAt: 0 },
        })
        expect(
          readApplicationState(application.current()).connections[1]?.availability.observedAt,
        ).toBe(0)
        expect(contributions).toHaveLength(baselineContributions)
        clock = 600_003
        if (outcome === 'rejected')
          refreshResult.reject(
            new GitHubConnectionError('bad-refresh-token', 'private obsolete refresh detail'),
          )
        else refreshResult.resolve(obsolete)
      }
      await vi.waitFor(() => expect(contributions.length).toBeGreaterThan(baselineContributions))
      const afterObsoleteRefresh = readApplicationState(application.current())
      const credentialAfterObsoleteRefresh = await credentialVault.read('github-connection')
      const completedContributions = contributions.length
      const tokensAfterObsoleteRefresh = [...providerTokens]
      providerTokens.length = 0

      // A later real observation must use the replacement without a restart or authorization.
      clock = 600_004
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() => expect(contributions.length).toBeGreaterThan(completedContributions))
      const recovered = readApplicationState(application.current())
      expect(credentialAfterObsoleteRefresh).toEqual(replacement)
      expect(await credentialVault.read('github-connection')).toEqual(replacement)
      expect(afterObsoleteRefresh.connections[1]?.availability.status).toBe('available')
      expect(tokensAfterObsoleteRefresh.every((token) => token === replacement.accessToken)).toBe(
        true,
      )
      expect(providerTokens).toEqual(['harmless-replacement-access', 'harmless-replacement-access'])
      expect(recovered.connections[1]).toMatchObject({
        id: 'github-connection',
        name: 'Personal GitHub',
        githubIdentity: { id: '42', login: 'octocat' },
        availability: { status: 'available', observedAt: 600_004 },
      })
      expect(recovered.projects[0]).toMatchObject({
        ref: fixtureResourceRef(fixtureProjectManagement(GITHUB_INTENT).ref),
        connectionId: 'github-connection',
        resource: { kind: 'current-readable', observation: { observedAt: 600_004 } },
        mapsMembership: { kind: 'current-complete' },
      })
      expect(recovered.projects).toMatchObject([fixtureProjectManagement(GITHUB_INTENT)])
      expect(recovered.authorizationOperations).toEqual([
        {
          id: operationId,
          connection: { kind: 'current', id: 'github-connection', accountId: '42' },
          status: 'granted',
        },
      ])
      expect(configuration.writes).toHaveLength(1)
      expect(configuration.writes[0]?.projects).toMatchObject([GITHUB_INTENT])
      expect(configuration.writes[0]?.connections).toEqual(githubConfiguration().connections)
      expect(configuration.writes[0]?.automation).toEqual(BASE_CONFIGURATION.automation)
      expect(refreshRequests).toEqual(['refresh-one'])
      expect(contributions.at(-1)?.attempts).toEqual([
        expect.objectContaining({
          kind: 'observed',
          scope: {
            kind: 'project',
            project: { integration: 'github', id: GITHUB_INTENT.ref.projectId },
          },
          observedAt: 600_004,
          provenance: {
            integration: 'github',
            connectionId: 'github-connection',
            repositoryId: '84',
            stage: 'repository',
          },
        }),
        expect.objectContaining({
          kind: 'observed',
          scope: {
            kind: 'maps-membership',
            project: { integration: 'github', id: GITHUB_INTENT.ref.projectId },
          },
          observedAt: 600_004,
          provenance: {
            integration: 'github',
            connectionId: 'github-connection',
            repositoryId: '84',
            stage: 'map-list',
          },
        }),
      ])
      for (const state of states) {
        const serialized = JSON.stringify(state)
        for (const secret of [
          expiring.accessToken,
          expiring.refreshToken,
          replacement.accessToken,
          replacement.refreshToken,
          obsolete.accessToken,
          obsolete.refreshToken,
          'private-device',
          'private obsolete refresh detail',
        ])
          expect(serialized).not.toContain(secret)
      }
    } finally {
      replacementWriteResult.resolve()
      refreshResult.resolve(obsolete)
      unsubscribe()
      await application.stop()
    }
  })

  it('serializes refresh, cleans removed credentials, and requires authorization on bad refresh', async () => {
    let clock = 0
    const expiring = { ...CREDENTIALS, accessTokenExpiresAt: 600_001 }
    const credentials = memoryVault({ 'github-connection': expiring })
    const github = scriptedGitHub()
    const providerTokens: string[] = []
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({ ...githubConfiguration(), projects: [GITHUB_INTENT] })
        .document,
      credentialVault: credentials.vault,
      github,
      ...sourceOptions({ now: () => clock, concurrentTokenRequests: true, providerTokens }),
      now: () => clock,
    })
    await application.start()
    providerTokens.length = 0
    clock = 300_001

    const refreshed = await Promise.all([
      application.execute(
        commandSchema.parse({
          type: 'refresh-project',
          project: fixtureProjectRef(fixtureProjectManagement(GITHUB_INTENT).ref),
          expectedConfigurationVersion: 1,
        }),
      ),
      application.execute(
        commandSchema.parse({
          type: 'refresh-project',
          project: fixtureProjectRef(fixtureProjectManagement(GITHUB_INTENT).ref),
          expectedConfigurationVersion: 1,
        }),
      ),
    ])

    for (const outcome of refreshed)
      expect(outcome).toMatchObject({
        ok: true,
        result: {
          type: 'refresh-project',
          project: fixtureProjectManagement(GITHUB_INTENT).ref,
          attempt: {
            kind: 'observed',
            attemptedAt: 300_001,
            observedAt: 300_001,
            provenance: {
              integration: 'github',
              connectionId: 'github-connection',
              repositoryId: '84',
              stage: 'repository',
            },
          },
        },
      })
    expect(providerTokens.length).toBeGreaterThan(0)
    expect(providerTokens.every((token) => token === 'access-two')).toBe(true)
    expect(github.refresh).toHaveBeenCalledOnce()
    expect(credentials.records.get('github-connection')?.accessToken).toBe('access-two')
    expect(
      (
        await application.execute(
          commandSchema.parse({
            type: 'remove-project',
            project: fixtureProjectRef(fixtureProjectManagement(GITHUB_INTENT).ref),
            expectedConfigurationVersion: readApplicationState(application.current())
              .configurationVersion,
          }),
        )
      ).ok,
    ).toBe(true)
    const removed = await application.execute(
      commandSchema.parse({
        type: 'remove-connection',
        connectionId: 'github-connection',
        expectedConfigurationVersion: readApplicationState(application.current())
          .configurationVersion,
      }),
    )
    expect(removed.ok).toBe(true)
    expect(credentials.records.has('github-connection')).toBe(false)
    await application.stop()

    const badGitHub = scriptedGitHub({
      refresh: new GitHubConnectionError(
        'bad-refresh-token',
        'GitHub authorization must be renewed.',
      ),
    })
    const bad = createRoadmapApplication({
      configuration: memoryConfiguration({ ...githubConfiguration(), projects: [GITHUB_INTENT] })
        .document,
      credentialVault: memoryVault({
        'github-connection': { ...CREDENTIALS, accessTokenExpiresAt: 1 },
      }).vault,
      github: badGitHub,
      ...sourceOptions(),
      now: () => 0,
    })
    await bad.start()
    expect(readApplicationState(bad.current()).connections[1]?.availability.status).toBe(
      'authorization-required',
    )
    const failedRefresh = await bad.execute(
      commandSchema.parse({
        type: 'refresh-project',
        project: fixtureProjectRef(fixtureProjectManagement(GITHUB_INTENT).ref),
        expectedConfigurationVersion: 1,
      }),
    )
    expect(failedRefresh).toMatchObject({
      operation: 'refresh-project',
      subject: { kind: 'project', project: fixtureProjectManagement(GITHUB_INTENT).ref },
      ok: true,
      result: {
        type: 'refresh-project',
        project: fixtureProjectManagement(GITHUB_INTENT).ref,
        attempt: {
          kind: 'failed',
          attemptedAt: 0,
          provenance: {
            integration: 'github',
            connectionId: 'github-connection',
            repositoryId: '84',
            stage: 'credentials',
          },
          cause: expect.any(String),
        },
      },
    })
    if (!failedRefresh.ok || failedRefresh.result.type !== 'refresh-project')
      throw new Error('Expected the completed authorization-required source attempt.')
    expect(failedRefresh.result.attempt).not.toHaveProperty('observedAt')
    expect(JSON.stringify(failedRefresh)).not.toContain('access-one')
    await bad.stop()
  })

  it('keeps last-good Connection availability through a transient token refresh failure', async () => {
    let clock = 0
    const github = scriptedGitHub({
      refresh: new GitHubConnectionError('network', 'private network detail'),
    })
    const application = createRoadmapApplication({
      configuration: memoryConfiguration({ ...githubConfiguration(), projects: [GITHUB_INTENT] })
        .document,
      credentialVault: memoryVault({
        'github-connection': { ...CREDENTIALS, accessTokenExpiresAt: 600_001 },
      }).vault,
      github,
      ...sourceOptions({ now: () => clock }),
      now: () => clock,
    })
    await application.start()
    expect(readApplicationState(application.current()).connections[1]?.availability).toEqual({
      status: 'available',
      observedAt: 0,
    })

    clock = 300_001
    const degradedRefresh = await application.execute(
      commandSchema.parse({
        type: 'refresh-project',
        project: fixtureProjectRef(fixtureProjectManagement(GITHUB_INTENT).ref),
        expectedConfigurationVersion: 1,
      }),
    )
    expect(degradedRefresh).toMatchObject({
      operation: 'refresh-project',
      subject: { kind: 'project', project: fixtureProjectManagement(GITHUB_INTENT).ref },
      ok: true,
      result: {
        type: 'refresh-project',
        project: fixtureProjectManagement(GITHUB_INTENT).ref,
        attempt: {
          kind: 'degraded',
          attemptedAt: 300_001,
          observedAt: 0,
          provenance: {
            integration: 'github',
            connectionId: 'github-connection',
            repositoryId: '84',
            stage: 'repository',
          },
          cause: expect.any(String),
        },
      },
    })
    expect(JSON.stringify(degradedRefresh)).not.toContain('private network detail')

    expect(readApplicationState(application.current()).connections[1]?.availability).toEqual({
      status: 'available',
      observedAt: 0,
    })
    expect(JSON.stringify(readApplicationState(application.current()))).not.toContain(
      'private network detail',
    )
    await application.stop()
  })

  it('keeps a Connection and requires authorization when its stored credential is invalid', async () => {
    const invalidVault: CredentialVault = {
      async read() {
        throw new CredentialVaultError(
          'invalid',
          'Roadmap found an invalid credential bundle in macOS Keychain.',
        )
      },
      async write() {},
      async delete() {},
      async cleanupOrphans() {},
    }
    const application = createRoadmapApplication({
      configuration: memoryConfiguration(githubConfiguration()).document,
      credentialVault: invalidVault,
      github: scriptedGitHub(),
      ...sourceOptions(),
      now: () => 0,
    })

    await application.start()
    expect(readApplicationState(application.current()).connections[1]?.availability).toMatchObject({
      status: 'authorization-required',
    })
    await application.stop()
  })

  it('retries a network failure and does not restore interrupted or expired operations', async () => {
    vi.useFakeTimers()
    const github = scriptedGitHub({ beginFailures: 2 })
    const configuration = memoryConfiguration(BASE_CONFIGURATION)
    const vault = memoryVault()
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: vault.vault,
      github,
      ...sourceOptions(),
      now: () => 0,
    })
    await application.start()
    const begun = await application.execute(
      commandSchema.parse({
        type: 'begin-github-authorization',
        name: 'Personal GitHub',
        expectedConfigurationVersion: 1,
      }),
    )
    if (
      !begun.ok ||
      begun.result.type !== 'begin-github-authorization' ||
      begun.result.phase !== 'failed'
    )
      throw new Error('Expected the device acquisition failure.')
    const operationId = begun.result.operationId
    expect(begun).toMatchObject({
      operation: 'begin-github-authorization',
      subject: { kind: 'none' },
      ok: true,
      result: {
        type: 'begin-github-authorization',
        operationId,
        phase: 'failed',
        error: { code: 'authorization-failed', message: expect.any(String) },
      },
    })
    expect(begun.result).not.toHaveProperty('verificationUri')
    expect(begun.result).not.toHaveProperty('userCode')
    expect(begun.result).not.toHaveProperty('expiresAt')
    expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
      id: operationId,
      status: 'terminal',
      outcome: 'failed',
    })

    const failedRetry = await application.execute(
      commandSchema.parse({
        type: 'retry-github-authorization',
        operationId,
        expectedConfigurationVersion: 1,
      }),
    )
    expect(failedRetry).toMatchObject({
      operation: 'retry-github-authorization',
      subject: { kind: 'authorization', operationId },
      ok: true,
      result: {
        type: 'retry-github-authorization',
        operationId,
        phase: 'failed',
        error: { code: 'authorization-failed', message: expect.any(String) },
      },
    })
    expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
      id: operationId,
      status: 'terminal',
      outcome: 'failed',
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(github.beginDeviceAuthorization).toHaveBeenCalledTimes(2)
    expect(github.pollDeviceAuthorization).not.toHaveBeenCalled()
    const cancelledAfterFailure = await application.execute(
      commandSchema.parse({
        type: 'cancel-github-authorization',
        operationId,
        expectedConfigurationVersion: 1,
      }),
    )
    expect(cancelledAfterFailure).toMatchObject({
      ok: true,
      result: {
        type: 'cancel-github-authorization',
        operationId,
        phase: 'failed',
        error: { code: 'authorization-failed', message: expect.any(String) },
      },
    })
    const retried = await application.execute(
      commandSchema.parse({
        type: 'retry-github-authorization',
        operationId,
        expectedConfigurationVersion: 1,
      }),
    )
    expect(retried).toMatchObject({
      operation: 'retry-github-authorization',
      subject: { kind: 'authorization', operationId },
      ok: true,
      result: {
        type: 'retry-github-authorization',
        operationId,
        phase: 'waiting',
        verificationUri: 'https://github.com/login/device',
        userCode: 'CODE-3',
        expiresAt: 60_000,
      },
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(readApplicationState(application.current()).authorizationOperations[0]).toMatchObject({
        id: operationId,
        status: 'granted',
      }),
    )
    await application.stop()

    const interrupted = createRoadmapApplication({
      configuration: memoryConfiguration(BASE_CONFIGURATION).document,
      credentialVault: memoryVault().vault,
      github: scriptedGitHub({ polls: [{ status: 'pending' }] }),
      ...sourceOptions(),
      now: () => 0,
    })
    await interrupted.start()
    await interrupted.execute(
      commandSchema.parse({
        type: 'begin-github-authorization',
        name: 'Interrupted',
        expectedConfigurationVersion: 1,
      }),
    )
    await interrupted.stop()

    const restarted = createRoadmapApplication({
      configuration: memoryConfiguration(BASE_CONFIGURATION).document,
      credentialVault: memoryVault().vault,
      github: scriptedGitHub({ polls: [{ status: 'expired' }] }),
      ...sourceOptions(),
      now: () => 0,
    })
    await restarted.start()
    expect(readApplicationState(restarted.current()).authorizationOperations).toEqual([])
    const expiredBegin = await restarted.execute(
      commandSchema.parse({
        type: 'begin-github-authorization',
        name: 'Expired',
        expectedConfigurationVersion: 1,
      }),
    )
    if (
      !expiredBegin.ok ||
      expiredBegin.result.type !== 'begin-github-authorization' ||
      expiredBegin.result.phase !== 'waiting'
    )
      throw new Error('Expected actual waiting device authorization before expiration.')
    expect(expiredBegin.result).toEqual({
      type: 'begin-github-authorization',
      operationId: expiredBegin.result.operationId,
      phase: 'waiting',
      verificationUri: 'https://github.com/login/device',
      userCode: 'CODE-1',
      expiresAt: 60_000,
    })
    const expiredOperationId = expiredBegin.result.operationId
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(readApplicationState(restarted.current()).authorizationOperations[0]).toMatchObject({
        id: expiredOperationId,
        status: 'terminal',
        outcome: 'expired',
      }),
    )
    const cancelledAfterExpiry = await restarted.execute(
      commandSchema.parse({
        type: 'cancel-github-authorization',
        operationId: expiredBegin.result.operationId,
        expectedConfigurationVersion: 1,
      }),
    )
    expect(cancelledAfterExpiry).toMatchObject({
      ok: true,
      result: {
        type: 'cancel-github-authorization',
        operationId: expiredBegin.result.operationId,
        phase: 'expired',
      },
    })
    if (!cancelledAfterExpiry.ok) throw new Error('Expected the expired operation truth.')
    expect(cancelledAfterExpiry.result).toEqual({
      type: 'cancel-github-authorization',
      operationId: expiredBegin.result.operationId,
      phase: 'expired',
    })
    await restarted.stop()
  })

  it.each(['success', 'failure'] as const)(
    'joins a deferred authorization begin without installing its late %s result',
    async (completion) => {
      vi.useFakeTimers()
      const begin =
        deferred<Awaited<ReturnType<GitHubConnectionPort['beginDeviceAuthorization']>>>()
      const entered = deferred<void>()
      const configuration = memoryConfiguration(BASE_CONFIGURATION)
      const credentials = memoryVault()
      const github: GitHubConnectionPort = {
        ...scriptedGitHub(),
        async beginDeviceAuthorization() {
          entered.resolve()
          return begin.promise
        },
      }
      const states: ReadyApplicationState[] = []
      const application = createRoadmapApplication({
        configuration: configuration.document,
        credentialVault: credentials.vault,
        github,
        ...sourceOptions(),
        now: () => 0,
      })
      application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
      await application.start()
      const beginning = application.execute(
        commandSchema.parse({
          type: 'begin-github-authorization',
          name: 'Deferred GitHub',
          expectedConfigurationVersion: 1,
        }),
      )
      await entered.promise
      let stopped = false
      const stopping = application.stop().then(() => {
        stopped = true
      })
      const operationsAtStop = structuredClone(
        readApplicationState(application.current()).authorizationOperations,
      )
      const publicationsAtStop = states.length
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(stopped).toBe(false)
        if (completion === 'failure')
          begin.reject(new GitHubConnectionError('network', 'Harmless late begin failure.'))
        else
          begin.resolve({
            deviceCode: 'harmless-private-device',
            userCode: 'LATE-CODE',
            verificationUri: 'https://github.com/login/device',
            expiresAt: 60_000,
            intervalMs: 1,
          })
        const outcome = await beginning
        expect(outcome).toMatchObject({
          operation: 'begin-github-authorization',
          subject: { kind: 'none' },
          ok: false,
          error: { code: 'not-supported' },
        })
        expect(outcome).not.toHaveProperty('state')
        expect(JSON.stringify(outcome)).not.toContain('harmless-private-device')
        await stopping
        await vi.advanceTimersByTimeAsync(60_000)
        expect(readApplicationState(application.current()).authorizationOperations).toEqual(
          operationsAtStop,
        )
        expect(states).toHaveLength(publicationsAtStop)
        expect(configuration.writes).toEqual([])
        expect(credentials.records.size).toBe(0)
        expect(github.pollDeviceAuthorization).not.toHaveBeenCalled()
        expect(JSON.stringify(states)).not.toContain('harmless-private-device')
      } finally {
        begin.resolve({
          deviceCode: 'cleanup-device',
          userCode: 'CLEANUP',
          verificationUri: 'https://github.com/login/device',
          expiresAt: 60_000,
          intervalMs: 1,
        })
        await beginning
        await stopping
        await vi.advanceTimersByTimeAsync(0)
      }
    },
  )

  it.each(['success', 'failure'] as const)(
    'joins an active device poll and suppresses late %s authorization settlement',
    async (completion) => {
      vi.useFakeTimers()
      const poll = deferred<DeviceAuthorizationPoll>()
      const entered = deferred<void>()
      const configuration = memoryConfiguration(BASE_CONFIGURATION)
      const credentials = memoryVault()
      const github: GitHubConnectionPort = {
        ...scriptedGitHub(),
        async pollDeviceAuthorization(deviceCode) {
          expect(deviceCode).toBe('private-device-1')
          entered.resolve()
          return poll.promise
        },
      }
      const states: ReadyApplicationState[] = []
      const application = createRoadmapApplication({
        configuration: configuration.document,
        credentialVault: credentials.vault,
        github,
        ...sourceOptions(),
        now: () => 0,
      })
      application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
      await application.start()
      await application.execute(
        commandSchema.parse({
          type: 'begin-github-authorization',
          name: 'Polling GitHub',
          expectedConfigurationVersion: 1,
        }),
      )
      await vi.advanceTimersByTimeAsync(1)
      await entered.promise
      let stopped = false
      const stopping = application.stop().then(() => {
        stopped = true
      })
      const operationsAtStop = structuredClone(
        readApplicationState(application.current()).authorizationOperations,
      )
      const publicationsAtStop = states.length
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(stopped).toBe(false)
        if (completion === 'failure')
          poll.reject(new GitHubConnectionError('network', 'Harmless late poll failure.'))
        else poll.resolve({ status: 'granted', credentials: CREDENTIALS })
        await stopping
        await vi.advanceTimersByTimeAsync(60_000)
        expect(readApplicationState(application.current()).authorizationOperations).toEqual(
          operationsAtStop,
        )
        expect(states).toHaveLength(publicationsAtStop)
        expect(configuration.writes).toEqual([])
        expect(credentials.records.size).toBe(0)
        expect(github.identify).not.toHaveBeenCalled()
      } finally {
        poll.resolve({ status: 'pending' })
        await stopping
        await vi.advanceTimersByTimeAsync(0)
      }
    },
  )

  it.each(['success', 'failure'] as const)(
    'drains an already-started authorization vault write without late %s public settlement',
    async (completion) => {
      vi.useFakeTimers()
      const write = deferred<void>()
      const entered = deferred<void>()
      const configuration = memoryConfiguration(BASE_CONFIGURATION)
      const credentials = memoryVault()
      const completedWrites: string[] = []
      const vault: CredentialVault = {
        ...credentials.vault,
        async write(id, bundle) {
          entered.resolve()
          await write.promise
          await credentials.vault.write(id, bundle)
          completedWrites.push(id)
        },
      }
      const application = createRoadmapApplication({
        configuration: configuration.document,
        credentialVault: vault,
        github: scriptedGitHub(),
        ...sourceOptions(),
        now: () => 0,
      })
      const states: ReadyApplicationState[] = []
      application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
      await application.start()
      await application.execute(
        commandSchema.parse({
          type: 'begin-github-authorization',
          name: 'Writing GitHub',
          expectedConfigurationVersion: 1,
        }),
      )
      await vi.advanceTimersByTimeAsync(1)
      await entered.promise
      let stopped = false
      const stopping = application.stop().then(() => {
        stopped = true
      })
      const operationsAtStop = structuredClone(
        readApplicationState(application.current()).authorizationOperations,
      )
      const publicationsAtStop = states.length
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(stopped).toBe(false)
        if (completion === 'failure') write.reject(new Error('Private late vault write detail.'))
        else write.resolve()
        await stopping
        await vi.advanceTimersByTimeAsync(0)
        expect(completedWrites).toHaveLength(completion === 'success' ? 1 : 0)
        expect(configuration.writes).toEqual([])
        expect(readApplicationState(application.current()).authorizationOperations).toEqual(
          operationsAtStop,
        )
        expect(states).toHaveLength(publicationsAtStop)
        expect(JSON.stringify(states)).not.toContain('Private late vault write detail.')
      } finally {
        write.resolve()
        await stopping
        await vi.advanceTimersByTimeAsync(0)
      }
    },
  )

  it.each(['success', 'failure'] as const)(
    'joins authorization identity verification without a late %s vault or configuration effect',
    async (completion) => {
      vi.useFakeTimers()
      const identity = deferred<GitHubConnectionIdentity>()
      const entered = deferred<void>()
      const configuration = memoryConfiguration(BASE_CONFIGURATION)
      const credentials = memoryVault()
      const github: GitHubConnectionPort = {
        ...scriptedGitHub(),
        async identify(token) {
          expect(token).toBe(CREDENTIALS.accessToken)
          entered.resolve()
          return identity.promise
        },
      }
      const application = createRoadmapApplication({
        configuration: configuration.document,
        credentialVault: credentials.vault,
        github,
        ...sourceOptions(),
        now: () => 0,
      })
      const states: ReadyApplicationState[] = []
      application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
      await application.start()
      await application.execute(
        commandSchema.parse({
          type: 'begin-github-authorization',
          name: 'Identity verification',
          expectedConfigurationVersion: 1,
        }),
      )
      await vi.advanceTimersByTimeAsync(1)
      await entered.promise
      let stopped = false
      const stopping = application.stop().then(() => {
        stopped = true
      })
      const operationsAtStop = structuredClone(
        readApplicationState(application.current()).authorizationOperations,
      )
      const publicationsAtStop = states.length
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(stopped).toBe(false)
        if (completion === 'failure')
          identity.reject(new GitHubConnectionError('network', 'Harmless late identity failure.'))
        else identity.resolve({ id: '42', login: 'octocat' })
        await stopping
        await vi.advanceTimersByTimeAsync(0)
        expect(credentials.records.size).toBe(0)
        expect(configuration.writes).toEqual([])
        expect(readApplicationState(application.current()).authorizationOperations).toEqual(
          operationsAtStop,
        )
        expect(states).toHaveLength(publicationsAtStop)
      } finally {
        identity.resolve({ id: '42', login: 'octocat' })
        await stopping
        await vi.advanceTimersByTimeAsync(0)
      }
    },
  )

  it.each([
    { stage: 'network', completion: 'success' },
    { stage: 'network', completion: 'failure' },
    { stage: 'identity', completion: 'success' },
    { stage: 'identity', completion: 'failure' },
    { stage: 'vault', completion: 'success' },
    { stage: 'vault', completion: 'failure' },
  ] satisfies Array<{
    stage: 'network' | 'identity' | 'vault'
    completion: 'success' | 'failure'
  }>)(
    'joins autonomous credential refresh at $stage without late $completion settlement',
    async ({ stage, completion }) => {
      vi.useFakeTimers()
      let clock = 0
      const refresh = deferred<CredentialBundle>()
      const identity = deferred<GitHubConnectionIdentity>()
      const write = deferred<void>()
      const entered = deferred<void>()
      const expiring = { ...CREDENTIALS, accessTokenExpiresAt: 600_001 }
      const refreshed = {
        ...CREDENTIALS,
        accessToken: 'harmless-late-access',
        refreshToken: 'harmless-late-refresh',
      }
      const credentials = memoryVault({ 'github-connection': expiring })
      const writes: CredentialBundle[] = []
      const identified: string[] = []
      const vault: CredentialVault = {
        ...credentials.vault,
        async write(id, bundle) {
          writes.push(bundle)
          if (stage === 'vault') {
            entered.resolve()
            await write.promise
          }
          await credentials.vault.write(id, bundle)
        },
      }
      const github: GitHubConnectionPort = {
        ...scriptedGitHub(),
        async refresh(token) {
          expect(token).toBe('refresh-one')
          if (stage === 'network') {
            entered.resolve()
            return refresh.promise
          }
          return refreshed
        },
        async identify(token) {
          identified.push(token)
          if (stage === 'identity' && token === refreshed.accessToken) {
            entered.resolve()
            return identity.promise
          }
          return { id: '42', login: 'octocat' }
        },
      }
      const configuration = memoryConfiguration({
        ...githubConfiguration(),
        projects: [GITHUB_INTENT],
      })
      const providerTokens: string[] = []
      const source = sourceOptions({ now: () => clock, reconcileMs: 1_000, providerTokens })
      const application = createRoadmapApplication({
        configuration: configuration.document,
        credentialVault: vault,
        github,
        ...source,
        admissions: {
          ...source.admissions,
          github: createGitHubProjectAdmission({
            async inspectWorkspace() {
              throw new Error('Harmless unavailable Workspace.')
            },
          }),
        },
        now: () => clock,
      })
      const states: ReadyApplicationState[] = []
      application.subscribe((state) => states.push(structuredClone(readApplicationState(state))))
      let stopping: Promise<void> | undefined
      try {
        await application.start()
        expect(
          readApplicationState(application.current()).connections[1]?.availability.status,
        ).toBe('available')
        providerTokens.length = 0
        clock = 600_002
        await vi.advanceTimersByTimeAsync(1_000)
        await entered.promise
        let stopped = false
        stopping = application.stop().then(() => {
          stopped = true
        })
        const publicAtStop = structuredClone(readApplicationState(application.current()))
        const publicationsAtStop = states.length
        const identifiesAtStop = identified.length
        const writesAtStop = writes.length
        await vi.advanceTimersByTimeAsync(0)
        expect(stopped).toBe(false)
        if (stage === 'network') {
          if (completion === 'failure')
            refresh.reject(
              new GitHubConnectionError('bad-refresh-token', 'Harmless late refresh rejection.'),
            )
          else refresh.resolve(refreshed)
        } else if (stage === 'identity') {
          if (completion === 'failure')
            identity.reject(
              new GitHubConnectionError('unauthorized', 'Harmless late refresh identity failure.'),
            )
          else identity.resolve({ id: '42', login: 'octocat' })
        } else if (completion === 'failure')
          write.reject(new Error('Private late refresh vault detail.'))
        else write.resolve()
        await stopping
        await vi.advanceTimersByTimeAsync(60_000)
        expect(readApplicationState(application.current()).connections).toEqual(
          publicAtStop.connections,
        )
        expect(readApplicationState(application.current()).authorizationOperations).toEqual(
          publicAtStop.authorizationOperations,
        )
        expect(states).toHaveLength(publicationsAtStop)
        expect(identified).toHaveLength(identifiesAtStop)
        expect(writes).toHaveLength(writesAtStop)
        expect(providerTokens).toEqual([])
        expect(configuration.writes).toEqual([])
        expect(JSON.stringify(states)).not.toContain('harmless-late-access')
        expect(JSON.stringify(states)).not.toContain('Private late refresh vault detail.')
      } finally {
        refresh.resolve(refreshed)
        identity.resolve({ id: '42', login: 'octocat' })
        write.resolve()
        await (stopping ?? application.stop())
        await vi.advanceTimersByTimeAsync(0)
      }
    },
  )
})
