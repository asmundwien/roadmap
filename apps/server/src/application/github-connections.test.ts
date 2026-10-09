import * as filesystem from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApplicationState, ProjectRegistration } from '@roadmap/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ConfigurationDocument,
  type ConfigurationRead,
  type ConfigurationWrite,
  createConfigurationDocument,
  decodeConfigurationDocument,
} from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import {
  type CredentialBundle,
  type DeviceAuthorizationPoll,
  GitHubConnectionError,
  type GitHubConnectionPort,
} from '../github/connections.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type { SourceContribution } from '../observation/source.ts'
import type { GitHubProjectIntent, ProjectConfiguration } from '../projects/registry.ts'
import { createRoadmapApplication } from './application.ts'
import {
  type CredentialVault,
  CredentialVaultError,
  createMacOsCredentialVault,
  type KeychainPort,
} from './credential-vault.ts'
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
const GITHUB_REGISTRATION: ProjectRegistration = {
  key: { integration: 'github', id: 'octocat/roadmap' },
  connectionId: 'github-connection',
  locator: { integration: 'github', repositoryId: '84', nameWithOwner: 'octocat/roadmap' },
  workspace: { path: '/roadmap', gitIdentity: '84' },
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
  return { document, writes }
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
    operations: createApplicationOperations(),
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

    const begun = await application.execute({
      type: 'begin-github-authorization',
      name: 'Personal GitHub',
      expectedConfigurationVersion: 1,
    })

    expect(begun).toMatchObject({ ok: true, result: { type: 'authorization-started' } })
    expect(application.current().supportedIntegrations).toContainEqual(github.integration)
    expect(application.current().authorizationOperations[0]).toMatchObject({
      status: 'waiting',
      verificationUri: 'https://github.com/login/device',
      userCode: 'CODE-1',
      expiresAt: 60_000,
    })
    expect(JSON.stringify(application.current())).not.toContain('private-device')
    expect(JSON.stringify(application.current())).not.toContain('access-one')

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(application.current().authorizationOperations[0]).toMatchObject({ status: 'granted' }),
    )
    expect(application.current().connections).toEqual(
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
      application.current().connections.find((connection) => connection.integration === 'github')
        ?.availability.observedAt,
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
        await application.execute({
          type: 'begin-github-authorization',
          name: 'Personal GitHub',
          expectedConfigurationVersion: 1,
        })
        await vi.advanceTimersByTimeAsync(1)
        await entered.promise

        expect(configuration.writes).toEqual([])
        expect(application.current().configurationVersion).toBe(1)
        expect(application.current().connections).toHaveLength(1)
        expect(application.current().authorizationOperations[0]?.status).toBe('waiting')
        expect(credentials.records.size).toBe(0)

        if (rejectVault) gate.reject(new Error('private vault failure'))
        else gate.resolve()
        await vi.waitFor(() =>
          expect(application.current().authorizationOperations[0]?.status).toBe(
            rejectVault ? 'failed' : 'granted',
          ),
        )
        expect(configuration.writes).toHaveLength(rejectVault ? 0 : 1)
        expect(application.current().connections).toHaveLength(rejectVault ? 1 : 2)
        expect(credentials.records.size).toBe(rejectVault ? 0 : 1)
        expect(JSON.stringify(application.current())).not.toContain('private vault failure')
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
      application.subscribe((state) => states.push(state))
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
        await application.execute({
          type: 'begin-github-authorization',
          ...(reauthorizing ? { connectionId: 'github-connection' } : {}),
          name: 'Personal GitHub',
          expectedConfigurationVersion: 1,
        })
        await vi.advanceTimersByTimeAsync(1)
        await vi.waitFor(() =>
          expect(application.current().authorizationOperations[0]?.status).not.toBe('waiting'),
        )

        const stored = decodeConfigurationDocument(JSON.parse(await readFile(path, 'utf8')))
        if (!stored.ok) throw new Error('Expected valid committed configuration')
        const committed = failure !== 'rename'
        expect(stored.value.configurationVersion).toBe(committed ? 2 : 1)
        expect(application.current().configurationVersion).toBe(committed ? 2 : 1)
        expect(stored.value.projects).toEqual(initial.projects)
        expect(application.current().registrations).toEqual(
          reauthorizing ? [GITHUB_REGISTRATION] : [],
        )
        expect(application.current().authorizationOperations[0]?.status).toBe(
          failure === 'directory-close' ? 'granted' : 'failed',
        )
        if (failure === 'directory-sync') {
          expect(application.current().automation.availability).toMatchObject({
            status: 'unavailable',
          })
        }
        if (reauthorizing || committed) {
          const connection = stored.value.connections.find((item) => item.integration === 'github')
          if (!connection) throw new Error('Expected retained configured GitHub identity')
          expect(connection.githubIdentity).toEqual({ id: '42', login: 'octocat' })
          expect(credentials.records.get(connection.id)).toEqual(renewed)
          expect(application.current().connections).toContainEqual(
            expect.objectContaining({
              id: connection.id,
              githubIdentity: connection.githubIdentity,
            }),
          )
        } else {
          expect(stored.value).toEqual(initial)
          expect(credentials.records.size).toBe(0)
          expect(application.current().connections).toHaveLength(1)
        }
        const publicAndDisk = JSON.stringify({
          states,
          current: application.current(),
          stored: stored.value,
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
        expect(application.current().connections[1]?.availability.status).toBe(
          rejectVault ? 'authorization-required' : 'available',
        )
        expect(application.current().connections[1]?.githubIdentity).toEqual({
          id: '42',
          login: 'octocat',
        })
        expect(JSON.stringify(application.current())).not.toContain('access-two')
        expect(JSON.stringify(application.current())).not.toContain(
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
    const begun = await application.execute({
      type: 'begin-github-authorization',
      name: 'Personal GitHub',
      expectedConfigurationVersion: 1,
    })
    if (!begun.ok || begun.result.type !== 'authorization-started') throw new Error('not started')
    const operationId = begun.result.operationId

    await application.execute({
      type: 'cancel-github-authorization',
      operationId,
      expectedConfigurationVersion: 1,
    })
    expect(application.current().authorizationOperations[0]).toMatchObject({
      id: operationId,
      status: 'cancelled',
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(github.pollDeviceAuthorization).not.toHaveBeenCalled()

    await application.execute({
      type: 'retry-github-authorization',
      operationId,
      expectedConfigurationVersion: 1,
    })
    await vi.waitFor(() =>
      expect(application.current().authorizationOperations[0]).toMatchObject({
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
    expect(application.current().authorizationOperations[0]).toMatchObject({
      id: operationId,
      status: 'waiting',
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(
      () => {
        expect(github.pollDeviceAuthorization).toHaveBeenCalledTimes(2)
        expect(application.current().authorizationOperations[0]).toMatchObject({
          id: operationId,
          status: 'denied',
        })
      },
      { interval: 1 },
    )
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

    const begun = await application.execute({
      type: 'begin-github-authorization',
      connectionId: 'github-connection',
      name: 'Personal GitHub',
      expectedConfigurationVersion: 1,
    })
    if (!begun.ok || begun.result.type !== 'authorization-started') throw new Error('not started')
    const operationId = begun.result.operationId
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(application.current().authorizationOperations).toContainEqual({
        id: operationId,
        connectionId: 'github-connection',
        status: 'granted',
      }),
    )
    expect(configuration.writes).toHaveLength(1)
    expect(configuration.writes[0]?.projects).toEqual([project])
    expect(configuration.writes[0]?.connections).toHaveLength(existing.connections.length)
    expect(application.current().registrations).toEqual([GITHUB_REGISTRATION])
    expect(credentials.records.get('github-connection')).toEqual(renewed)
    providerTokens.length = 0
    expect(
      await application.execute({
        type: 'refresh-project',
        project: GITHUB_REGISTRATION.key,
        expectedConfigurationVersion: application.current().configurationVersion,
      }),
    ).toMatchObject({
      ok: true,
      result: { type: 'project-refreshed', project: GITHUB_REGISTRATION.key },
    })
    expect(providerTokens.length).toBeGreaterThan(0)
    expect(providerTokens.every((token) => token === 'access-renewed')).toBe(true)
    expect(application.current().projects[0]).toMatchObject({
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

    await application.execute({
      type: 'begin-github-authorization',
      name: 'Duplicate',
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(application.current().authorizationOperations[0]).toMatchObject({
        status: 'failed',
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
    await second.execute({
      type: 'begin-github-authorization',
      connectionId: 'github-connection',
      name: 'Personal GitHub',
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(second.current().authorizationOperations[0]).toMatchObject({ status: 'failed' }),
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
    await third.execute({
      type: 'begin-github-authorization',
      name: 'Cannot save',
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(third.current().authorizationOperations[0]).toMatchObject({
        status: 'failed',
        cause: 'GitHub authorization could not be saved.',
      }),
    )
    expect(third.current().connections).toHaveLength(1)
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
    const states: ApplicationState[] = []
    const unsubscribe = application.subscribe((state) => states.push(state))
    try {
      await application.start()
      expect(application.current().projects[0]).toMatchObject({
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

      const begun = await application.execute({
        type: 'begin-github-authorization',
        connectionId: 'github-connection',
        name: 'Personal GitHub',
        expectedConfigurationVersion: 1,
      })
      if (!begun.ok || begun.result.type !== 'authorization-started')
        throw new Error('The replacement authorization did not start.')
      const operationId = begun.result.operationId
      await vi.advanceTimersByTimeAsync(1)
      if (holdReplacementWrite) {
        await replacementWriteEntered.promise
        expect(configuration.writes).toEqual([])
        expect(application.current().configurationVersion).toBe(1)
        expect(application.current().authorizationOperations[0]?.status).toBe('waiting')
        expect(application.current().projects[0]?.resource).toMatchObject({
          kind: 'current-readable',
          observation: { observedAt: 0 },
        })
        expect(application.current().connections[1]?.availability.observedAt).toBe(0)
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
        expect(application.current().authorizationOperations).toContainEqual({
          id: operationId,
          connectionId: 'github-connection',
          status: 'granted',
        }),
      )
      if (!holdReplacementWrite)
        expect(await credentialVault.read('github-connection')).toEqual(replacement)
      expect(application.current().configurationVersion).toBe(2)
      if (!holdReplacementWrite) {
        expect(application.current().projects[0]?.resource).toMatchObject({
          kind: 'current-readable',
          observation: { observedAt: 0 },
        })
        expect(application.current().connections[1]?.availability.observedAt).toBe(0)
        expect(contributions).toHaveLength(baselineContributions)
        clock = 600_003
        if (outcome === 'rejected')
          refreshResult.reject(
            new GitHubConnectionError('bad-refresh-token', 'private obsolete refresh detail'),
          )
        else refreshResult.resolve(obsolete)
      }
      await vi.waitFor(() => expect(contributions.length).toBeGreaterThan(baselineContributions))
      const afterObsoleteRefresh = application.current()
      const credentialAfterObsoleteRefresh = await credentialVault.read('github-connection')
      const completedContributions = contributions.length
      const tokensAfterObsoleteRefresh = [...providerTokens]
      providerTokens.length = 0

      // A later real observation must use the replacement without a restart or authorization.
      clock = 600_004
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() => expect(contributions.length).toBeGreaterThan(completedContributions))
      const recovered = application.current()
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
        key: GITHUB_REGISTRATION.key,
        connectionId: 'github-connection',
        resource: { kind: 'current-readable', observation: { observedAt: 600_004 } },
        mapsMembership: { kind: 'current-complete' },
      })
      expect(recovered.registrations).toEqual([GITHUB_REGISTRATION])
      expect(recovered.authorizationOperations).toEqual([
        { id: operationId, connectionId: 'github-connection', status: 'granted' },
      ])
      expect(configuration.writes).toHaveLength(1)
      expect(configuration.writes[0]?.projects).toEqual([GITHUB_INTENT])
      expect(configuration.writes[0]?.connections).toEqual(githubConfiguration().connections)
      expect(configuration.writes[0]?.automation).toEqual(BASE_CONFIGURATION.automation)
      expect(refreshRequests).toEqual(['refresh-one'])
      expect(contributions.at(-1)?.attempts).toEqual([
        expect.objectContaining({
          kind: 'observed',
          scope: { kind: 'project', project: GITHUB_REGISTRATION.key },
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
          scope: { kind: 'maps-membership', project: GITHUB_REGISTRATION.key },
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
      application.execute({
        type: 'refresh-project',
        project: GITHUB_REGISTRATION.key,
        expectedConfigurationVersion: 1,
      }),
      application.execute({
        type: 'refresh-project',
        project: GITHUB_REGISTRATION.key,
        expectedConfigurationVersion: 1,
      }),
    ])

    for (const outcome of refreshed)
      expect(outcome).toMatchObject({
        ok: true,
        result: { type: 'project-refreshed', project: GITHUB_REGISTRATION.key },
      })
    expect(providerTokens.length).toBeGreaterThan(0)
    expect(providerTokens.every((token) => token === 'access-two')).toBe(true)
    expect(github.refresh).toHaveBeenCalledOnce()
    expect(credentials.records.get('github-connection')?.accessToken).toBe('access-two')
    expect(
      (
        await application.execute({
          type: 'remove-project',
          project: GITHUB_REGISTRATION.key,
          expectedConfigurationVersion: application.current().configurationVersion,
        })
      ).ok,
    ).toBe(true)
    const removed = await application.execute({
      type: 'remove-connection',
      connectionId: 'github-connection',
      expectedConfigurationVersion: application.current().configurationVersion,
    })
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
      configuration: memoryConfiguration(githubConfiguration()).document,
      credentialVault: memoryVault({
        'github-connection': { ...CREDENTIALS, accessTokenExpiresAt: 1 },
      }).vault,
      github: badGitHub,
      ...sourceOptions(),
      now: () => 0,
    })
    await bad.start()
    expect(bad.current().connections[1]?.availability.status).toBe('authorization-required')
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
    expect(application.current().connections[1]?.availability).toEqual({
      status: 'available',
      observedAt: 0,
    })

    clock = 300_001
    expect(
      await application.execute({
        type: 'refresh-project',
        project: GITHUB_REGISTRATION.key,
        expectedConfigurationVersion: 1,
      }),
    ).toMatchObject({
      ok: true,
      result: { type: 'project-refreshed', project: GITHUB_REGISTRATION.key },
    })

    expect(application.current().connections[1]?.availability).toEqual({
      status: 'available',
      observedAt: 0,
    })
    expect(JSON.stringify(application.current())).not.toContain('private network detail')
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
    expect(application.current().connections[1]?.availability).toMatchObject({
      status: 'authorization-required',
    })
    await application.stop()
  })

  it('retries a network failure and does not restore interrupted or expired operations', async () => {
    vi.useFakeTimers()
    const github = scriptedGitHub({ beginFailures: 1 })
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
    const begun = await application.execute({
      type: 'begin-github-authorization',
      name: 'Personal GitHub',
      expectedConfigurationVersion: 1,
    })
    if (!begun.ok || begun.result.type !== 'authorization-started') throw new Error('not started')
    expect(application.current().authorizationOperations[0]).toMatchObject({ status: 'failed' })

    await application.execute({
      type: 'retry-github-authorization',
      operationId: begun.result.operationId,
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(application.current().authorizationOperations[0]).toMatchObject({ status: 'granted' }),
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
    await interrupted.execute({
      type: 'begin-github-authorization',
      name: 'Interrupted',
      expectedConfigurationVersion: 1,
    })
    await interrupted.stop()

    const restarted = createRoadmapApplication({
      configuration: memoryConfiguration(BASE_CONFIGURATION).document,
      credentialVault: memoryVault().vault,
      github: scriptedGitHub({ polls: [{ status: 'expired' }] }),
      ...sourceOptions(),
      now: () => 0,
    })
    await restarted.start()
    expect(restarted.current().authorizationOperations).toEqual([])
    await restarted.execute({
      type: 'begin-github-authorization',
      name: 'Expired',
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() =>
      expect(restarted.current().authorizationOperations[0]).toMatchObject({ status: 'expired' }),
    )
    await restarted.stop()
  })
})
