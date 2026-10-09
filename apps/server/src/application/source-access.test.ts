import type { ApplicationState, ProjectKey } from '@roadmap/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigurationDocument } from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { createGitHubClient } from '../github/client.ts'
import { type CredentialBundle, createGitHubConnectionPort } from '../github/connections.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import type { SourceContribution } from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import { createRoadmapApplication } from './application.ts'
import { type CredentialVault, CredentialVaultError } from './credential-vault.ts'
import { createApplicationOperations } from './operations.ts'

const PROJECT: ProjectKey = { integration: 'github', id: 'saved-project' }
const CREDENTIALS: CredentialBundle = {
  accessToken: 'harmless-saved-token',
  refreshToken: 'harmless-saved-refresh',
  accessTokenExpiresAt: 10_000_000,
  refreshTokenExpiresAt: 100_000_000,
}
const CONFIGURATION: ProjectConfiguration = {
  schemaVersion: 6,
  configurationVersion: 7,
  connections: [
    { id: 'local', integration: 'local', name: 'Local', builtIn: true },
    {
      id: 'saved-github',
      integration: 'github',
      name: 'Saved GitHub',
      builtIn: false,
      githubIdentity: { id: '42', login: 'octocat' },
    },
  ],
  projects: [
    {
      ref: { integration: 'github', projectId: 'saved-project' },
      connectionId: 'saved-github',
      locator: { repositoryId: '84', nameWithOwner: 'octocat/configured-hint' },
      workspace: { path: '/harmless-missing-worktree' },
    },
  ],
  automation: { enabled: false, enabledProjects: [] },
}

type AccessFailure =
  | 'network'
  | 'malformed-identity'
  | 'vault-unavailable'
  | 'rejected-credential'
  | 'account-mismatch'
const TRANSIENT_FAILURES: AccessFailure[] = ['network', 'malformed-identity', 'vault-unavailable']

function fixture(initial: AccessFailure | null, liveRefresh = false) {
  let failure: AccessFailure | null = initial
  const credentials: CredentialBundle = liveRefresh
    ? { ...CREDENTIALS, accessTokenExpiresAt: 1_000_000, refreshTokenExpiresAt: 2_000_000 }
    : CREDENTIALS
  const requests: string[] = []
  const identityTokens: string[] = []
  const providerTokens: string[] = []
  const writes: ProjectConfiguration[] = []
  const vaultWrites: CredentialBundle[] = []
  const authorizationRequests: string[] = []
  const configuration: ConfigurationDocument = {
    async load() {
      return { ok: true, document: CONFIGURATION }
    },
    subscribe() {
      return () => undefined
    },
    async write(next) {
      writes.push(next)
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {},
  }
  const credentialVault: CredentialVault = {
    async read(connectionId) {
      if (connectionId !== 'saved-github') throw new Error('Unexpected vault account')
      if (failure === 'vault-unavailable') {
        throw new CredentialVaultError(
          'unavailable',
          'Credential storage is temporarily unavailable.',
        )
      }
      return credentials
    },
    async write(_connectionId, credentials) {
      vaultWrites.push(credentials)
    },
    async delete() {
      throw new Error('Recovery must retain saved credentials')
    },
    async cleanupOrphans() {},
  }
  const github = createGitHubConnectionPort({
    clientId: 'harmless-client',
    appSlug: 'harmless-app',
    now: Date.now,
    fetch: async (input, init) => {
      const url = String(input)
      if (liveRefresh && url === 'https://github.com/login/oauth/access_token') {
        authorizationRequests.push(url)
        if (failure === 'network') throw new Error('private refresh detail harmless-secret')
        if (failure === 'rejected-credential') {
          return Response.json({
            error: 'bad_refresh_token',
            error_description: 'private refresh detail harmless-secret',
          })
        }
        return Response.json({
          access_token: 'harmless-rotated-token',
          refresh_token: 'harmless-rotated-refresh',
          expires_in: 1_000,
          refresh_token_expires_in: 10_000,
        })
      }
      if (url !== 'https://api.github.com/user') {
        authorizationRequests.push(url)
        throw new Error('Recovery must not initiate device authorization or refresh')
      }
      identityTokens.push(new Headers(init?.headers).get('Authorization') ?? '')
      if (failure === 'network') throw new Error('Harmless network outage')
      if (failure === 'rejected-credential') return new Response('{}', { status: 401 })
      return Response.json(
        failure === 'malformed-identity'
          ? { login: 'octocat' }
          : { id: failure === 'account-mismatch' ? 99 : 42, login: 'octocat' },
      )
    },
  })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = `${url.pathname}${url.search}`
    providerTokens.push(
      (new Headers(init?.headers).get('Authorization') ?? '').replace(/^Bearer /, ''),
    )
    requests.push(path)
    if (path === '/repositories/84')
      return Response.json({ id: 84, full_name: 'octocat/provider-name' })
    if (
      path ===
      '/repos/octocat/provider-name/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1'
    )
      return Response.json([])
    throw new Error('Unexpected harmless provider request')
  })
  const pool = createGitHubObserverPool({ now: Date.now, logger: { warn() {} } })
  const contributions: SourceContribution[] = []
  const application = createRoadmapApplication({
    configuration,
    credentialVault,
    github,
    now: Date.now,
    operations: createApplicationOperations(),
    admissions: {
      github: createGitHubProjectAdmission({
        async inspectWorkspace() {
          throw new Error('Worktree is missing')
        },
      }),
    },
    observers: {
      local() {
        throw new Error('No Local Project is configured')
      },
      github(input) {
        const observer = pool.create(input)
        observer.subscribe((contribution) => contributions.push(contribution))
        return observer
      },
      reconcileGitHubTopology: (inputs) => pool.reconcileTopology(inputs),
      stop: () => pool.stop(),
    },
    providerRead: (accessToken) => createGitHubClient({ token: accessToken }),
  })
  return {
    application,
    requests,
    identityTokens,
    providerTokens,
    contributions,
    writes,
    vaultWrites,
    authorizationRequests,
    recover() {
      failure = null
    },
    failRefresh(next: AccessFailure) {
      failure = next
    },
  }
}

function expectSavedManagement(state: ApplicationState) {
  expect(state.configurationVersion).toBe(7)
  expect(state.configuration.valid).toBe(true)
  expect(state.registrations).toEqual([
    {
      key: PROJECT,
      connectionId: 'saved-github',
      locator: {
        integration: 'github',
        repositoryId: '84',
        nameWithOwner: 'octocat/configured-hint',
      },
      workspace: { path: '/harmless-missing-worktree', gitIdentity: '84' },
    },
  ])
  expect(state.connections.find((connection) => connection.id === 'saved-github')).toMatchObject({
    name: 'Saved GitHub',
    githubIdentity: { id: '42', login: 'octocat' },
  })
  expect(state.projects[0]).toMatchObject({ key: PROJECT, connectionId: 'saved-github' })
  expect(state.projects[0]?.actions.map((action) => action.id)).toEqual([
    'open-roadmap',
    'open-source',
  ])
}

function expectRecovered(test: ReturnType<typeof fixture>, observedAt: number) {
  const state = test.application.current()
  expectSavedManagement(state)
  expect(state.projects[0]).toMatchObject({
    name: 'octocat/provider-name',
    availability: { status: 'available', observedAt },
    openMaps: [],
    closedMaps: [],
  })
  expect(
    state.connections.find((connection) => connection.id === 'saved-github')?.availability,
  ).toEqual({ status: 'available', observedAt })
  // One actual stable-ID read and complete empty membership, not an admission content preflight.
  expect(test.requests).toEqual([
    '/repositories/84',
    '/repos/octocat/provider-name/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1',
  ])
  expect(test.identityTokens.length).toBeGreaterThan(0)
  expect(test.identityTokens.every((token) => token === 'Bearer harmless-saved-token')).toBe(true)
  expect(test.providerTokens).toEqual(['harmless-saved-token', 'harmless-saved-token'])
  expect(test.writes).toEqual([])
  expect(test.vaultWrites).toEqual([])
  expect(test.authorizationRequests).toEqual([])
  expect(state.authorizationOperations).toEqual([])
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('RoadmapApplication saved GitHub access recovery', () => {
  it.each(TRANSIENT_FAILURES)(
    'retains saved management without rejected credentials or successful observation after %s',
    async (failure) => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)
      const test = fixture(failure)
      const states: ApplicationState[] = []
      const unsubscribe = test.application.subscribe((state) => states.push(state))
      try {
        await test.application.start()
        expect(states.length).toBeGreaterThan(0)
        for (const state of states) {
          if (state.configurationVersion !== 7) continue
          expectSavedManagement(state)
          expect(state.projects[0]?.availability.status).toBe('unavailable')
          expect(state.projects[0]?.availability.observedAt).toBeUndefined()
          expect(
            state.connections.find((connection) => connection.id === 'saved-github')?.availability,
          ).toMatchObject({ status: 'unavailable' })
          expect(
            state.connections.find((connection) => connection.id === 'saved-github')?.availability
              .observedAt,
          ).toBeUndefined()
        }
        expect(test.requests).toEqual([])
        expect(test.writes).toEqual([])
      } finally {
        unsubscribe()
        await test.application.stop()
      }
    },
  )

  it.each(TRANSIENT_FAILURES)(
    'recovers %s on the existing automatic observation cadence without restart or reauthorization',
    async (failure) => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)
      const test = fixture(failure)
      try {
        await test.application.start()
        expectSavedManagement(test.application.current())
        expect(test.requests).toEqual([])
        test.recover()
        await vi.advanceTimersByTimeAsync(30_000)
        expectRecovered(test, 31_000)
      } finally {
        await test.application.stop()
      }
    },
  )

  it.each(TRANSIENT_FAILURES)(
    'public refresh revalidates current Connection-bound access after %s without restart or reauthorization',
    async (failure) => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)
      const test = fixture(failure)
      try {
        await test.application.start()
        expectSavedManagement(test.application.current())
        expect(test.requests).toEqual([])
        test.recover()
        vi.setSystemTime(2_000)
        const outcome = await test.application.execute({
          type: 'refresh-project',
          project: PROJECT,
          expectedConfigurationVersion: 7,
        })
        expect(outcome).toMatchObject({
          ok: true,
          result: { type: 'project-refreshed', project: PROJECT },
        })
        expectRecovered(test, 2_000)
      } finally {
        await test.application.stop()
      }
    },
  )

  it.each<AccessFailure>(['rejected-credential', 'account-mismatch'])(
    'requires authorization for proven %s rather than treating it as transient access',
    async (failure) => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)
      const test = fixture(failure)
      try {
        await test.application.start()
        expectSavedManagement(test.application.current())
        expect(
          test.application
            .current()
            .connections.find((connection) => connection.id === 'saved-github')?.availability,
        ).toMatchObject({ status: 'authorization-required' })
        expect(test.application.current().projects[0]?.availability.observedAt).toBeUndefined()
        test.recover()
        await vi.advanceTimersByTimeAsync(30_000)
        await test.application.execute({
          type: 'refresh-project',
          project: PROJECT,
          expectedConfigurationVersion: 7,
        })
        expect(
          test.application
            .current()
            .connections.find((connection) => connection.id === 'saved-github')?.availability
            .status,
        ).toBe('authorization-required')
        expect(test.requests).toEqual([])
        expect(test.writes).toEqual([])
        expect(test.vaultWrites).toEqual([])
        expect(test.authorizationRequests).toEqual([])
      } finally {
        await test.application.stop()
      }
    },
  )
})

describe('RoadmapApplication provider credential resolution', () => {
  const failures: {
    failure: AccessFailure | 'authorization-required'
    connectionStatus: 'authorization-required' | 'available'
  }[] = [
    {
      failure: 'authorization-required',
      connectionStatus: 'authorization-required',
    },
    {
      failure: 'rejected-credential',
      connectionStatus: 'authorization-required',
    },
    {
      failure: 'account-mismatch',
      connectionStatus: 'authorization-required',
    },
    {
      failure: 'network',
      connectionStatus: 'available',
    },
    {
      failure: 'malformed-identity',
      connectionStatus: 'available',
    },
  ]

  it.each(failures)(
    'commits credential-stage $failure from the actual token callback without provider reads or fresh source time',
    async ({ failure, connectionStatus }) => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)
      const test = fixture(null, true)
      const states: ApplicationState[] = []
      const unsubscribe = test.application.subscribe((state) => states.push(state))
      try {
        await test.application.start()
        expect(test.application.current().projects[0]?.availability).toEqual({
          status: 'available',
          observedAt: 1_000,
        })
        const providerRequests = [...test.requests]
        if (failure !== 'authorization-required') test.failRefresh(failure)
        vi.setSystemTime(failure === 'authorization-required' ? 2_000_000 : 1_000_000)
        await test.application.execute({
          type: 'refresh-project',
          project: PROJECT,
          expectedConfigurationVersion: 7,
        })

        const state = test.application.current()
        expectSavedManagement(state)
        expect(state.projects[0]).toMatchObject({
          name: 'octocat/provider-name',
          availability: { status: 'unavailable', observedAt: 1_000 },
        })
        expect(state.roadmap.unreachable).toContainEqual(
          expect.objectContaining({ integration: 'github', project: PROJECT }),
        )
        expect(
          state.connections.find((connection) => connection.id === 'saved-github')?.availability,
        ).toMatchObject({
          status: connectionStatus,
          observedAt: 1_000,
        })
        expect(test.requests).toEqual(providerRequests)
        expect(test.providerTokens).toEqual(['harmless-saved-token', 'harmless-saved-token'])
        expect(test.writes).toEqual([])
        expect(test.vaultWrites).toEqual([])
        expect(state.authorizationOperations).toEqual([])
        const failedSource = test.contributions
          .at(-1)
          ?.attempts.find(
            (attempt) => attempt.kind === 'failed' && attempt.scope.kind === 'project',
          )
        expect(failedSource).toMatchObject({
          kind: 'failed',
          scope: { kind: 'project', project: PROJECT },
          attemptedAt: failure === 'authorization-required' ? 2_000_000 : 1_000_000,
          provenance: {
            integration: 'github',
            connectionId: 'saved-github',
            repositoryId: '84',
            stage: 'credentials',
          },
        })
        expect(failedSource).not.toHaveProperty('observedAt')
        for (const published of states) {
          const serialized = JSON.stringify(published)
          expect(serialized).not.toContain('harmless-saved-token')
          expect(serialized).not.toContain('harmless-saved-refresh')
          expect(serialized).not.toContain('harmless-rotated-token')
          expect(serialized).not.toContain('harmless-secret')
          expect(serialized).not.toContain('private refresh detail')
          const observedAt = published.projects[0]?.availability.observedAt
          if (observedAt !== undefined) expect(observedAt).toBe(1_000)
        }
      } finally {
        unsubscribe()
        await test.application.stop()
      }
    },
  )

  it('uses the rotated current credential only after successful refresh and account validation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const test = fixture(null, true)
    try {
      await test.application.start()
      vi.setSystemTime(1_000_000)
      await test.application.execute({
        type: 'refresh-project',
        project: PROJECT,
        expectedConfigurationVersion: 7,
      })

      expect(test.application.current().projects[0]?.availability).toEqual({
        status: 'available',
        observedAt: 1_000_000,
      })
      expect(test.providerTokens).toEqual([
        'harmless-saved-token',
        'harmless-saved-token',
        'harmless-rotated-token',
        'harmless-rotated-token',
      ])
      expect(test.vaultWrites).toEqual([
        {
          accessToken: 'harmless-rotated-token',
          refreshToken: 'harmless-rotated-refresh',
          accessTokenExpiresAt: 2_000_000,
          refreshTokenExpiresAt: 11_000_000,
        },
      ])
      expect(test.identityTokens).toEqual([
        'Bearer harmless-saved-token',
        'Bearer harmless-rotated-token',
      ])
      expect(test.authorizationRequests).toEqual(['https://github.com/login/oauth/access_token'])
    } finally {
      await test.application.stop()
    }
  })
})
