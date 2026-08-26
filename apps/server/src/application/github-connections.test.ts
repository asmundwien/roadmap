import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type CredentialBundle,
  type DeviceAuthorizationPoll,
  GitHubConnectionError,
  type GitHubConnectionPort,
} from '../github/connections.ts'
import type { AdapterSlice, WayfinderAdapter } from '../store.ts'
import { type AdapterRuntime, createRoadmapApplication } from './application.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
  RoadmapConfiguration,
} from './configuration.ts'
import { type CredentialVault, CredentialVaultError } from './credential-vault.ts'

const EMPTY_SLICE: AdapterSlice = { projects: [], unreachable: [] }
const LOCAL_CONNECTION: RoadmapConfiguration['connections'][number] = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}
const BASE_CONFIGURATION: RoadmapConfiguration = {
  schemaVersion: 5,
  configurationVersion: 1,
  connections: [LOCAL_CONNECTION],
  projects: [],
  automation: { enabled: false, enabledProjects: [] },
}
const CREDENTIALS: CredentialBundle = {
  accessToken: 'access-one',
  refreshToken: 'refresh-one',
  accessTokenExpiresAt: 3_600_000,
  refreshTokenExpiresAt: 30_000_000,
}

function memoryConfiguration(initial: RoadmapConfiguration) {
  let current = initial
  const writes: RoadmapConfiguration[] = []
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
      return { ok: true }
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
        expiresAt: 60_000,
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

function immediateAdapter(): WayfinderAdapter {
  return {
    type: 'local',
    start(host) {
      host.update(EMPTY_SLICE)
    },
    stop() {},
  }
}

function githubConfiguration(): RoadmapConfiguration {
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

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

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
      createAdapters: () => [immediateAdapter()],
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
    await settle()

    expect(application.current().authorizationOperations[0]).toMatchObject({ status: 'granted' })
    expect(application.current().connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          integration: 'github',
          githubIdentity: { id: '42', login: 'octocat' },
          availability: { status: 'available', observedAt: 0 },
        }),
      ]),
    )
    const saved = configuration.writes[0]?.connections.find(
      (connection) => connection.integration === 'github',
    )
    expect(saved?.githubIdentity).toEqual({ id: '42', login: 'octocat' })
    expect(credentials.records.get(saved?.id ?? '')).toEqual(CREDENTIALS)
    expect(JSON.stringify(configuration.writes)).not.toContain('access-one')
    await application.stop()
  })

  it('cancels, retries, honors slow_down, and records denial without polling after cancellation', async () => {
    vi.useFakeTimers()
    const configuration = memoryConfiguration(BASE_CONFIGURATION)
    const github = scriptedGitHub({ polls: [{ status: 'slow-down' }, { status: 'denied' }] })
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: memoryVault().vault,
      github,
      createAdapters: () => [immediateAdapter()],
      now: () => 0,
    })
    await application.start()
    const begun = await application.execute({
      type: 'begin-github-authorization',
      name: 'Personal GitHub',
      expectedConfigurationVersion: 1,
    })
    if (!begun.ok || begun.result.type !== 'authorization-started') throw new Error('not started')

    await application.execute({
      type: 'cancel-github-authorization',
      operationId: begun.result.operationId,
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(github.pollDeviceAuthorization).not.toHaveBeenCalled()

    await application.execute({
      type: 'retry-github-authorization',
      operationId: begun.result.operationId,
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(github.pollDeviceAuthorization).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(github.pollDeviceAuthorization).toHaveBeenCalledTimes(1)
    await vi.runOnlyPendingTimersAsync()
    await settle()
    expect(application.current().authorizationOperations[0]).toMatchObject({ status: 'denied' })
    await application.stop()
  })

  it('reauthenticates a Connection without changing dependent Project registrations', async () => {
    vi.useFakeTimers()
    const project: RoadmapConfiguration['projects'][number] = {
      key: { integration: 'github', id: 'octocat/roadmap' },
      connectionId: 'github-connection',
      locator: {
        integration: 'github',
        repositoryId: '84',
        nameWithOwner: 'octocat/roadmap',
      },
      workspace: { path: '/roadmap', gitIdentity: '84' },
    }
    const existing = { ...githubConfiguration(), projects: [project] }
    const renewed = {
      ...CREDENTIALS,
      accessToken: 'access-renewed',
      refreshToken: 'refresh-renewed',
    }
    const credentials = memoryVault({ 'github-connection': CREDENTIALS })
    const configuration = memoryConfiguration(existing)
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: credentials.vault,
      github: scriptedGitHub({ polls: [{ status: 'granted', credentials: renewed }] }),
      createAdapters: () => [immediateAdapter()],
      now: () => 0,
    })
    await application.start()

    const begun = await application.execute({
      type: 'begin-github-authorization',
      connectionId: 'github-connection',
      name: 'Personal GitHub',
      expectedConfigurationVersion: 1,
    })
    expect(begun.ok).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await settle()

    expect(application.current().authorizationOperations[0]).toMatchObject({
      connectionId: 'github-connection',
      status: 'granted',
    })
    expect(configuration.writes).toHaveLength(1)
    expect(configuration.writes[0]?.projects).toEqual([project])
    expect(configuration.writes[0]?.connections).toHaveLength(existing.connections.length)
    expect(credentials.records.get('github-connection')).toEqual(renewed)
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
      createAdapters: () => [immediateAdapter()],
      now: () => 0,
    })
    await application.start()

    await application.execute({
      type: 'begin-github-authorization',
      name: 'Duplicate',
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(application.current().authorizationOperations[0]).toMatchObject({
      status: 'failed',
      cause: 'GitHub user octocat already has a Connection.',
    })
    expect(configuration.writes).toEqual([])
    await application.stop()

    const mismatchedGitHub = scriptedGitHub({ identityId: '99' })
    const second = createRoadmapApplication({
      configuration: memoryConfiguration(existing).document,
      credentialVault: credentials.vault,
      github: mismatchedGitHub,
      createAdapters: () => [immediateAdapter()],
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
    await settle()
    expect(second.current().authorizationOperations[0]).toMatchObject({ status: 'failed' })
    expect(credentials.records.get('github-connection')).toEqual(CREDENTIALS)
    await second.stop()

    const failedVault = memoryVault({}, true)
    const third = createRoadmapApplication({
      configuration: memoryConfiguration(BASE_CONFIGURATION).document,
      credentialVault: failedVault.vault,
      github: scriptedGitHub(),
      createAdapters: () => [immediateAdapter()],
      now: () => 0,
    })
    await third.start()
    await third.execute({
      type: 'begin-github-authorization',
      name: 'Cannot save',
      expectedConfigurationVersion: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(third.current().authorizationOperations[0]).toMatchObject({
      status: 'failed',
      cause: 'GitHub authorization could not be saved.',
    })
    expect(third.current().connections).toHaveLength(1)
    await third.stop()
  })

  it('serializes refresh, cleans removed credentials, and requires authorization on bad refresh', async () => {
    let clock = 0
    const expiring = { ...CREDENTIALS, accessTokenExpiresAt: 600_001 }
    const credentials = memoryVault({ 'github-connection': expiring })
    const github = scriptedGitHub()
    let accessToken: AdapterRuntime['accessToken'] = async () => {
      throw new Error('Adapter runtime was not installed.')
    }
    const application = createRoadmapApplication({
      configuration: memoryConfiguration(githubConfiguration()).document,
      credentialVault: credentials.vault,
      github,
      createAdapters: (_configuration, nextRuntime) => {
        accessToken = nextRuntime.accessToken
        return [immediateAdapter()]
      },
      now: () => clock,
    })
    await application.start()
    clock = 300_001

    await Promise.all([accessToken('github-connection'), accessToken('github-connection')])

    expect(github.refresh).toHaveBeenCalledOnce()
    expect(credentials.records.get('github-connection')?.accessToken).toBe('access-two')
    const removed = await application.execute({
      type: 'remove-connection',
      connectionId: 'github-connection',
      expectedConfigurationVersion: 1,
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
      createAdapters: () => [immediateAdapter()],
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
    let accessToken: AdapterRuntime['accessToken'] = async () => {
      throw new Error('Adapter runtime was not installed.')
    }
    const application = createRoadmapApplication({
      configuration: memoryConfiguration(githubConfiguration()).document,
      credentialVault: memoryVault({
        'github-connection': { ...CREDENTIALS, accessTokenExpiresAt: 600_001 },
      }).vault,
      github,
      createAdapters: (_configuration, nextRuntime) => {
        accessToken = nextRuntime.accessToken
        return [immediateAdapter()]
      },
      now: () => clock,
    })
    await application.start()
    expect(application.current().connections[1]?.availability).toEqual({
      status: 'available',
      observedAt: 0,
    })

    clock = 300_001
    await expect(accessToken('github-connection')).rejects.toThrow('private network detail')

    expect(application.current().connections[1]?.availability).toEqual({
      status: 'available',
      observedAt: 0,
    })
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
      createAdapters: () => [immediateAdapter()],
      now: () => 0,
    })

    await application.start()
    expect(application.current().connections[1]?.availability).toMatchObject({
      status: 'authorization-required',
      cause: 'Roadmap found an invalid credential bundle in macOS Keychain.',
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
      createAdapters: () => [immediateAdapter()],
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
    await settle()
    expect(application.current().authorizationOperations[0]).toMatchObject({ status: 'granted' })
    await application.stop()

    const interrupted = createRoadmapApplication({
      configuration: memoryConfiguration(BASE_CONFIGURATION).document,
      credentialVault: memoryVault().vault,
      github: scriptedGitHub({ polls: [{ status: 'pending' }] }),
      createAdapters: () => [immediateAdapter()],
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
      createAdapters: () => [immediateAdapter()],
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
    await settle()
    expect(restarted.current().authorizationOperations[0]).toMatchObject({ status: 'expired' })
    await restarted.stop()
  })
})
