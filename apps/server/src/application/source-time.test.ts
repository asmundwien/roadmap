import type { ApplicationState, Project, ProjectKey } from '@roadmap/contracts'
import { stateEnvelopeCodec } from '@roadmap/contracts/codecs'
import { describe, expect, it } from 'vitest'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { GitHubError } from '../github/client.ts'
import type { CredentialBundle, GitHubConnectionPort } from '../github/connections.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import { refineSourceContribution, type SourceContribution } from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import {
  controlledSourceFixture,
  fixtureAdmissions,
  sourceFixture,
} from '../source-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const REMOTE: ProjectKey = { integration: 'github', id: 'managed-remote' }
const LOCAL: ProjectKey = { integration: 'local', id: 'managed-local' }
const PRIVATE_DETAIL = 'private-provider-access-token-detail'
const INITIAL_CREDENTIALS: CredentialBundle = {
  accessToken: 'source-time-access-one',
  refreshToken: 'source-time-refresh',
  // The public source read at 3000 causes the real credential owner to refresh.
  accessTokenExpiresAt: 303_000,
  refreshTokenExpiresAt: 2_000_000,
}
const REFRESHED_CREDENTIALS: CredentialBundle = {
  ...INITIAL_CREDENTIALS,
  accessToken: 'source-time-access-two',
  accessTokenExpiresAt: 1_000_000,
}

type ProviderMode = 'complete' | 'transient' | '401' | 'ambiguous' | 'mismatch' | 'incomplete'
const FAILURES: ReadonlyArray<{
  mode: ProviderMode
  initialHealth: 'available' | 'unavailable' | 'authorization-required'
}> = [
  { mode: 'transient', initialHealth: 'unavailable' },
  { mode: '401', initialHealth: 'authorization-required' },
  { mode: 'ambiguous', initialHealth: 'available' },
  { mode: 'mismatch', initialHealth: 'available' },
]

function localContent(name: string): Project {
  return {
    key: LOCAL,
    name,
    sourcePath: '/source-time/local',
    openMaps: [],
    closedMaps: [],
    warnings: [],
  }
}

function fixture(initialMode: ProviderMode) {
  let clock = 1000
  let mode = initialMode
  let savedCredentials = INITIAL_CREDENTIALS
  const providerReads: Array<{ path: string; token: string; at: number }> = []
  const states: ApplicationState[] = []
  const local = controlledSourceFixture(
    LOCAL,
    sourceFixture([localContent('Local baseline')], 1000),
  )
  let configuration: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [
      { id: 'local', integration: 'local', name: 'Local', builtIn: true },
      {
        id: 'work',
        integration: 'github',
        name: 'Work account',
        builtIn: false,
        githubIdentity: { id: '7', login: 'octocat' },
      },
    ],
    projects: [
      {
        ref: { integration: 'github', projectId: REMOTE.id },
        connectionId: 'work',
        displayName: 'Managed remote',
        locator: { repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
        workspace: { path: '/source-time/unavailable-worktree' },
      },
      {
        ref: { integration: 'local', projectId: LOCAL.id },
        connectionId: 'local',
        workspace: { path: '/source-time/local' },
      },
    ],
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
  const github: GitHubConnectionPort = {
    integration: {
      integration: 'github',
      name: 'GitHub',
      connectionKind: 'device-authorization',
      newInstallationUrl: 'https://github.com/apps/roadmap/installations/new',
      installationsUrl: 'https://github.com/settings/installations',
      authorizationsUrl: 'https://github.com/settings/connections/applications/client-id',
    },
    async beginDeviceAuthorization() {
      throw new Error('Device authorization is not used by this fixture')
    },
    async pollDeviceAuthorization() {
      return { status: 'pending' }
    },
    async identify(token) {
      if (token !== INITIAL_CREDENTIALS.accessToken && token !== REFRESHED_CREDENTIALS.accessToken)
        throw new Error('Unexpected account-validation token')
      return { id: '7', login: 'octocat' }
    },
    async refresh(token) {
      if (token !== INITIAL_CREDENTIALS.refreshToken) throw new Error('Unexpected refresh token')
      return REFRESHED_CREDENTIALS
    },
  }
  const pool = createGitHubObserverPool({
    now: () => clock,
    reconcileMs: 1_000_000,
    logger: { warn() {} },
  })
  const application = createRoadmapApplication({
    configuration: document,
    now: () => clock,
    github,
    credentialVault: {
      async read(connectionId) {
        if (connectionId !== 'work') throw new Error('Unexpected credential binding')
        return savedCredentials
      },
      async write(connectionId, credentials) {
        if (connectionId !== 'work') throw new Error('Unexpected credential binding')
        savedCredentials = credentials
      },
      async delete() {},
      async cleanupOrphans() {},
    },
    admissions: {
      local: fixtureAdmissions.local,
      github: createGitHubProjectAdmission({
        async inspectWorkspace() {
          throw new Error('Unavailable host worktree must not prevent remote source observation')
        },
      }),
    },
    providerRead(accessToken) {
      async function authorize(path: string) {
        const token = await accessToken()
        if (token !== savedCredentials.accessToken)
          throw new Error('Provider received a stale token')
        providerReads.push({ path, token, at: clock })
      }
      return {
        async restGet(path) {
          await authorize(path)
          if (path === '/repositories/42') {
            let error: GitHubError | undefined
            if (mode === 'transient')
              error = new GitHubError({ kind: 'transient', cause: 'network' })
            if (mode === '401')
              error = new GitHubError({ kind: 'authorization', proof: 'http-401' }, 401)
            if (mode === 'ambiguous')
              error = new GitHubError({ kind: 'access-ambiguous', evidence: 'http-404' }, 404)
            if (error) {
              error.message = PRIVATE_DETAIL
              throw error
            }
            return { id: mode === 'mismatch' ? 99 : 42, full_name: 'Acme/Roadmap' }
          }
          if (
            path ===
            '/repos/Acme/Roadmap/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1'
          )
            return [{ number: 108 }]
          throw new Error(`Unexpected provider request ${path}`)
        },
        async graphql(_query, variables) {
          await authorize('map-read')
          if (variables?.o0 !== 'Acme' || variables.n0 !== 'Roadmap' || variables.i0 !== 108)
            throw new Error('Unexpected source map binding')
          return {
            data: {
              rateLimit: { cost: 1, remaining: 5000, limit: 5000, resetAt: '2027-01-01T00:00:00Z' },
              m0: {
                databaseId: 42,
                nameWithOwner: 'Acme/Roadmap',
                issue: {
                  number: 108,
                  title: 'Unchanged remote map',
                  url: 'https://github.com/Acme/Roadmap/issues/108',
                  state: 'OPEN',
                  updatedAt: '2026-10-01T00:00:00Z',
                  closedAt: null,
                  body: '## Destination\n\nKeep truthful source observation time.\n',
                  subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
                  subIssues: {
                    totalCount: mode === 'incomplete' ? 1 : 0,
                    pageInfo: { hasNextPage: mode === 'incomplete' },
                    nodes: [],
                  },
                },
              },
            },
            errors: [],
          }
        },
      }
    },
    operations: createApplicationOperations(),
    observers: {
      local: () => local.observer,
      github: (input) => pool.create(input),
      reconcileGitHubTopology: (inputs) => pool.reconcileTopology(inputs),
      stop: () => pool.stop(),
    },
  })
  application.subscribe((state) => states.push(state))
  return {
    application,
    states,
    providerReads,
    credentials: () => savedCredentials,
    at(time: number, nextMode: ProviderMode) {
      clock = time
      mode = nextMode
    },
    updateLocal() {
      local.push(sourceFixture([localContent('Local changed independently')], 5000), {
        status: 'available',
        observedAt: 5000,
      })
    },
    async refresh() {
      return application.execute({
        type: 'refresh-project',
        project: REMOTE,
        expectedConfigurationVersion: application.current().configurationVersion,
      })
    },
  }
}

function remoteState(state: ApplicationState) {
  const connection = state.connections.find((value) => value.id === 'work')
  const project = state.projects.find((value) => value.key.id === REMOTE.id)
  if (!connection || !project) throw new Error('Configured remote identity disappeared')
  return { connection, project }
}

function expectConfiguredFacts(state: ApplicationState) {
  expect(state.registrations.find((value) => value.key.id === REMOTE.id)).toEqual({
    key: REMOTE,
    connectionId: 'work',
    displayName: 'Managed remote',
    locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
    workspace: { path: '/source-time/unavailable-worktree', gitIdentity: '42' },
  })
  expect(remoteState(state).connection).toMatchObject({
    id: 'work',
    githubIdentity: { id: '7', login: 'octocat' },
  })
  expect(JSON.stringify(state)).not.toContain(PRIVATE_DETAIL)
  expect(JSON.stringify(state)).not.toContain(INITIAL_CREDENTIALS.accessToken)
  expect(JSON.stringify(state)).not.toContain(REFRESHED_CREDENTIALS.accessToken)
}

describe('public successful source observation time', () => {
  it.each(FAILURES)(
    'does not invent Connection success on the first $mode read',
    async ({ mode, initialHealth }) => {
      const test = fixture(mode)
      try {
        await test.application.start()
        const state = test.application.current()
        const { connection, project } = remoteState(state)
        expect(connection.availability.status).toBe(initialHealth)
        expect(connection.availability.observedAt).toBeUndefined()
        expect(project.availability.status).toBe('unavailable')
        expect(project.availability.observedAt).toBeUndefined()
        expect(project.openMaps).toEqual([])
        expect(state.roadmap.unreachable.some((value) => value.project.id === REMOTE.id)).toBe(true)
        expectConfiguredFacts(state)
        expect(test.providerReads).toEqual([
          { path: '/repositories/42', token: INITIAL_CREDENTIALS.accessToken, at: 1000 },
        ])
        for (const published of test.states) {
          const remote = published.connections.find((value) => value.id === 'work')
          if (remote) expect(remote.availability.observedAt).toBeUndefined()
        }
      } finally {
        await test.application.stop()
      }
    },
  )

  it('publishes decodable unavailable health through repeated reads without a successful source time', async () => {
    const test = fixture('transient')
    try {
      await test.application.start()
      for (const time of [1000, 2000, 3000, 4000]) {
        if (time !== 1000) {
          test.at(time, 'transient')
          expect((await test.refresh()).ok).toBe(true)
        }
        const state = test.application.current()
        const { connection, project } = remoteState(state)
        expect(connection.availability).toMatchObject({ status: 'unavailable' })
        expect(connection.availability).not.toHaveProperty('observedAt')
        expect(project.availability).toMatchObject({ status: 'unavailable' })
        expect(project.availability).not.toHaveProperty('observedAt')
        expect(project.openMaps).toEqual([])
        expectConfiguredFacts(state)
      }
      expect(test.credentials()).toEqual(REFRESHED_CREDENTIALS)

      test.at(5000, 'complete')
      expect((await test.refresh()).ok).toBe(true)
      const recovered = remoteState(test.application.current())
      expect(recovered.connection.availability).toEqual({ status: 'available', observedAt: 5000 })
      expect(recovered.project.availability).toEqual({ status: 'available', observedAt: 5000 })

      for (const time of [6000, 7000]) {
        test.at(time, 'transient')
        expect((await test.refresh()).ok).toBe(true)
      }
      const retained = remoteState(test.application.current())
      expect(retained.connection.availability).toMatchObject({
        status: 'degraded',
        observedAt: 5000,
      })
      expect(retained.project.availability).toMatchObject({
        status: 'unavailable',
        observedAt: 5000,
      })
      expect(retained.project.openMaps).toEqual(recovered.project.openMaps)

      for (const published of test.states) {
        const envelope: unknown = JSON.parse(JSON.stringify({ type: 'state', state: published }))
        const decoded = stateEnvelopeCodec.decode(envelope)
        expect(decoded.ok).toBe(true)
        if (!decoded.ok) throw new Error('Application published an invalid state envelope')
        expect(decoded.value.state).toEqual(published)
      }
    } finally {
      await test.application.stop()
    }
  })

  it.each(FAILURES)(
    'retains success through $mode failure and credential refresh, then advances on identical recovery only',
    async ({ mode }) => {
      const test = fixture('complete')
      try {
        await test.application.start()
        const baseline = remoteState(test.application.current())
        expect(baseline.connection.availability).toEqual({ status: 'available', observedAt: 1000 })
        expect(baseline.project.availability).toEqual({ status: 'available', observedAt: 1000 })
        expect(baseline.project.openMaps).toHaveLength(1)
        expect(baseline.project.openMaps[0]?.ticketsComplete).toBe(true)
        const successfulMaps = baseline.project.openMaps
        const afterSuccess = test.states.length

        test.at(2000, mode)
        expect((await test.refresh()).ok).toBe(true)
        const failed = remoteState(test.application.current())
        expect(failed.connection.availability.observedAt).toBe(1000)
        expect(failed.project.availability).toMatchObject({
          status: 'unavailable',
          observedAt: 1000,
        })
        expect(failed.project.openMaps).toEqual(successfulMaps)
        expectConfiguredFacts(test.application.current())

        test.at(3000, mode)
        expect((await test.refresh()).ok).toBe(true)
        expect(test.credentials()).toEqual(REFRESHED_CREDENTIALS)
        expect(test.providerReads.at(-1)).toEqual({
          path: '/repositories/42',
          token: REFRESHED_CREDENTIALS.accessToken,
          at: 3000,
        })
        const credentialUpdated = remoteState(test.application.current())
        expect(credentialUpdated.connection.availability.observedAt).toBe(1000)
        expect(credentialUpdated.project.availability.observedAt).toBe(1000)
        expectConfiguredFacts(test.application.current())
        for (const published of test.states.slice(afterSuccess)) {
          const remote = remoteState(published)
          expect(remote.connection.availability.observedAt).toBe(1000)
          expect(remote.project.availability.observedAt).toBe(1000)
        }

        test.at(4000, 'complete')
        expect((await test.refresh()).ok).toBe(true)
        const recovered = remoteState(test.application.current())
        expect(recovered.connection.availability).toEqual({ status: 'available', observedAt: 4000 })
        expect(recovered.project.availability).toEqual({ status: 'available', observedAt: 4000 })
        expect(recovered.project.openMaps).toEqual(successfulMaps)
        const afterRecovery = test.states.length
        const remoteReadCount = test.providerReads.length

        test.at(5000, 'complete')
        test.updateLocal()
        const unrelated = test.application.current()
        expect(unrelated.projects.find((value) => value.key.id === LOCAL.id)).toMatchObject({
          availability: { status: 'available', observedAt: 5000 },
        })
        expect(unrelated.roadmap.projects.find((value) => value.key.id === LOCAL.id)?.name).toBe(
          'Local changed independently',
        )
        expect(unrelated.roadmap.capturedAt).toBe(5000)
        expect(test.providerReads).toHaveLength(remoteReadCount)
        expect(remoteState(unrelated).connection.availability.observedAt).toBe(4000)
        expect(remoteState(unrelated).project.availability.observedAt).toBe(4000)
        for (const published of test.states.slice(afterRecovery)) {
          expect(remoteState(published).connection.availability.observedAt).toBe(4000)
          expect(remoteState(published).project.availability.observedAt).toBe(4000)
        }
      } finally {
        await test.application.stop()
      }
    },
  )

  it('keeps Connection health available when successful resource reads have incomplete membership', async () => {
    const test = fixture('incomplete')
    try {
      await test.application.start()
      const state = test.application.current()
      const { connection, project } = remoteState(state)
      expect(connection.availability).toEqual({ status: 'available', observedAt: 1000 })
      expect(project.availability.status).toBe('unavailable')
      expect(project.availability.observedAt).toBeUndefined()
      expect(project.openMaps[0]).toMatchObject({ id: '108', ticketsComplete: false })
      expect(
        state.roadmap.unreachable.some(
          (value) => value.project.id === REMOTE.id && value.mapId === '108',
        ),
      ).toBe(true)
      expectConfiguredFacts(state)
    } finally {
      await test.application.stop()
    }
  })
})

describe('successful source health refinement', () => {
  const baseline: SourceContribution = {
    project: LOCAL,
    attempts: sourceFixture([localContent('Known source')], 1000).attempts,
    health: { status: 'available', observedAt: 1000 },
  }
  const failure: SourceContribution = {
    project: LOCAL,
    attempts: [
      {
        kind: 'failed',
        scope: { kind: 'project', project: LOCAL },
        attemptedAt: 2000,
        provenance: { integration: 'local', path: '/source-time/local', operation: 'inspect-root' },
        failure: { kind: 'filesystem', operation: 'inspect-root', code: 'EACCES' },
      },
    ],
    health: { status: 'unavailable', cause: 'Source cannot be read.' },
  }

  it('rejects health timestamps without successful current or retained source evidence', () => {
    expect(refineSourceContribution(failure)).toEqual(failure)
    expect(refineSourceContribution({ ...failure, health: { status: 'available' } })).not.toBeNull()
    for (const health of [
      { status: 'available', observedAt: 2000 },
      { status: 'degraded', cause: 'Read failed.', observedAt: 2000 },
      { status: 'unavailable', cause: 'Read failed.', observedAt: 2000 },
      { status: 'authorization-required', cause: 'Read failed.', observedAt: 2000 },
    ]) {
      expect(refineSourceContribution({ ...failure, health })).toBeNull()
    }
  })

  it('accepts actual retained success but rejects a failed attempt as replacement freshness', () => {
    const retained = { ...failure, health: { ...failure.health, observedAt: 1000 } }
    expect(refineSourceContribution(baseline)).toEqual(baseline)
    expect(refineSourceContribution(retained, baseline)).toEqual(retained)
    expect(refineSourceContribution(retained, retained)).toEqual(retained)
    expect(
      refineSourceContribution(
        {
          ...failure,
          health: { ...failure.health, observedAt: 2000 },
        },
        baseline,
      ),
    ).toBeNull()
    expect(
      refineSourceContribution({
        ...baseline,
        health: { status: 'available', observedAt: 2000 },
      }),
    ).toBeNull()
  })

  it('allows a source owner to retain a genuine prior scoped success', () => {
    const prior: SourceContribution = { ...baseline, health: { status: 'available' } }
    const retained = { ...failure, health: { ...failure.health, observedAt: 1000 } }
    expect(refineSourceContribution(prior)).toEqual(prior)
    expect(refineSourceContribution(retained, prior)).toEqual(retained)
  })

  it('accepts a chosen successful scope time without requiring every scope to match', () => {
    const mixed = {
      ...baseline,
      health: { status: 'available', observedAt: 1000 },
      attempts: baseline.attempts.map((attempt) =>
        attempt.kind === 'observed' && attempt.scope.kind === 'project'
          ? { ...attempt, attemptedAt: 2000, observedAt: 2000 }
          : attempt,
      ),
    }
    expect(refineSourceContribution(mixed)).toEqual(mixed)
  })

  it('does not borrow retained freshness from a different source identity', () => {
    expect(
      refineSourceContribution(
        {
          ...failure,
          health: { ...failure.health, observedAt: 1000 },
        },
        { ...baseline, project: { integration: 'local', id: 'unrelated-source' } },
      ),
    ).toBeNull()
  })

  it('accepts genuine success with incomplete membership without asserting resource completeness', () => {
    const unknownMap = {
      kind: 'observed',
      scope: { kind: 'map', map: { project: LOCAL, mapId: 'unknown-map' } },
      attemptedAt: 1000,
      observedAt: 1000,
      provenance: { integration: 'local', path: '/source-time/local/map.md', operation: 'read' },
      completeness: { kind: 'incomplete', reason: 'malformed' },
      value: {
        key: { project: LOCAL, mapId: 'unknown-map' },
        source: { kind: 'file', path: '/source-time/local/map.md' },
        status: 'unknown',
        updatedAt: 1000,
        body: {
          raw: '',
          destination: '',
          notes: [],
          decisions: [],
          notYetSpecified: [],
          notYetSpecifiedNote: '',
          outOfScope: [],
          sections: [],
          missingSections: [],
        },
        progress: null,
        unidentifiedTickets: [],
        warnings: [],
      },
    }
    const incomplete = {
      ...baseline,
      attempts: [
        ...baseline.attempts.map((attempt) =>
          attempt.kind === 'observed' && attempt.scope.kind === 'maps-membership'
            ? {
                ...attempt,
                completeness: { kind: 'incomplete', reason: 'unreadable' },
                value: { members: [{ project: LOCAL, mapId: 'unknown-map' }] },
              }
            : attempt,
        ),
        unknownMap,
      ],
    }
    expect(refineSourceContribution(incomplete)).toEqual(incomplete)
  })
})
