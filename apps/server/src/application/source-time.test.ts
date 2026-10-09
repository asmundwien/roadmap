import { commandSchema } from '@roadmap/contracts/operations'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { decodeStateEnvelope } from '@roadmap/contracts/wire'
import { describe, expect, it } from 'vitest'
import type { CredentialBundle, GitHubConnectionPort } from '../authorization/contracts.ts'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { GitHubError } from '../github/client.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import type { SourceProjectKey as ProjectKey } from '../observation/source.ts'
import { refineSourceContribution, type SourceContribution } from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import {
  fixtureProjectRef,
  fixtureResourceRef,
  readApplicationState,
} from '../public-test-fixtures.ts'
import {
  controlledSourceFixture,
  createSourceFixtureOwner,
  type FixtureProject,
  fixtureAdmissions,
  publicMapObservation,
  publicProjectObservation,
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

function localContent(name: string): FixtureProject {
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
  const states: ReadyApplicationState[] = []
  const readLocal = createSourceFixtureOwner()
  const local = controlledSourceFixture(LOCAL, readLocal([localContent('Local baseline')], 1000))
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
  application.subscribe((state) => states.push(readApplicationState(state)))
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
      local.push(readLocal([localContent('Local changed independently')], 5000), {
        status: 'available',
        observedAt: 5000,
      })
    },
    async refresh() {
      return application.execute(
        commandSchema.parse({
          type: 'refresh-project',
          project: fixtureProjectRef(REMOTE),
          expectedConfigurationVersion: readApplicationState(application.current())
            .configurationVersion,
        }),
      )
    },
  }
}

function remoteState(state: ReadyApplicationState) {
  const connection = state.connections.find((value) => value.id === 'work')
  const project = state.projects.find((value) => value.ref.projectId === REMOTE.id)
  if (!connection || !project) throw new Error('Configured remote identity disappeared')
  return { connection, project }
}

function expectConfiguredFacts(state: ReadyApplicationState) {
  expect(state.projects.find((value) => value.ref.projectId === REMOTE.id)).toMatchObject({
    ref: fixtureResourceRef(REMOTE),
    connectionId: 'work',
    source: { integration: 'github', repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
    management: {
      workspacePath: '/source-time/unavailable-worktree',
      displayName: 'Managed remote',
    },
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
        const state = readApplicationState(test.application.current())
        const { connection, project } = remoteState(state)
        expect(connection.availability.status).toBe(initialHealth)
        expect(connection.availability.observedAt).toBeUndefined()
        expect(project.resource.kind).toBe('never-observed')
        expect(publicProjectObservation(project)).toBeNull()
        expect(project.maps).toEqual([])
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
        const state = readApplicationState(test.application.current())
        const { connection, project } = remoteState(state)
        expect(connection.availability).toMatchObject({ status: 'unavailable' })
        expect(connection.availability).not.toHaveProperty('observedAt')
        expect(project.resource.kind).toBe('never-observed')
        expect(publicProjectObservation(project)).toBeNull()
        expect(project.maps).toEqual([])
        expectConfiguredFacts(state)
      }
      expect(test.credentials()).toEqual(REFRESHED_CREDENTIALS)

      test.at(5000, 'complete')
      expect((await test.refresh()).ok).toBe(true)
      const recovered = remoteState(readApplicationState(test.application.current()))
      expect(recovered.connection.availability).toEqual({ status: 'available', observedAt: 5000 })
      expect(recovered.project.resource).toMatchObject({
        kind: 'current-readable',
        observation: { observedAt: 5000 },
      })

      for (const time of [6000, 7000]) {
        test.at(time, 'transient')
        expect((await test.refresh()).ok).toBe(true)
      }
      const retained = remoteState(readApplicationState(test.application.current()))
      expect(retained.connection.availability).toMatchObject({
        status: 'degraded',
        observedAt: 5000,
      })
      expect(retained.project.resource).toMatchObject({
        kind: 'retained-unavailable',
        lastSuccessful: { observedAt: 5000 },
      })
      expect(retained.project.maps.map((map) => publicMapObservation(map)?.value)).toEqual(
        recovered.project.maps.map((map) => publicMapObservation(map)?.value),
      )

      for (const published of test.states) {
        const envelope: unknown = JSON.parse(JSON.stringify({ type: 'state', state: published }))
        const decoded = decodeStateEnvelope(envelope)
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
        const baseline = remoteState(readApplicationState(test.application.current()))
        expect(baseline.connection.availability).toEqual({ status: 'available', observedAt: 1000 })
        expect(baseline.project.resource).toMatchObject({
          kind: 'current-readable',
          observation: { observedAt: 1000 },
        })
        expect(baseline.project.maps).toHaveLength(1)
        expect(baseline.project.maps[0]?.ticketsMembership.kind).toBe('current-complete')
        const successfulMaps = baseline.project.maps.map((map) => publicMapObservation(map)?.value)
        const afterSuccess = test.states.length

        test.at(2000, mode)
        expect((await test.refresh()).ok).toBe(true)
        const failed = remoteState(readApplicationState(test.application.current()))
        expect(failed.connection.availability.observedAt).toBe(1000)
        expect(failed.project.resource).toMatchObject({
          kind: 'retained-unavailable',
          lastSuccessful: { observedAt: 1000 },
        })
        expect(failed.project.maps.map((map) => publicMapObservation(map)?.value)).toEqual(
          successfulMaps,
        )
        expectConfiguredFacts(readApplicationState(test.application.current()))

        test.at(3000, mode)
        expect((await test.refresh()).ok).toBe(true)
        expect(test.credentials()).toEqual(REFRESHED_CREDENTIALS)
        expect(test.providerReads.at(-1)).toEqual({
          path: '/repositories/42',
          token: REFRESHED_CREDENTIALS.accessToken,
          at: 3000,
        })
        const credentialUpdated = remoteState(readApplicationState(test.application.current()))
        expect(credentialUpdated.connection.availability.observedAt).toBe(1000)
        expect(publicProjectObservation(credentialUpdated.project)?.observedAt).toBe(1000)
        expectConfiguredFacts(readApplicationState(test.application.current()))
        for (const published of test.states.slice(afterSuccess)) {
          const remote = remoteState(published)
          expect(remote.connection.availability.observedAt).toBe(1000)
          expect(publicProjectObservation(remote.project)?.observedAt).toBe(1000)
        }

        test.at(4000, 'complete')
        expect((await test.refresh()).ok).toBe(true)
        const recovered = remoteState(readApplicationState(test.application.current()))
        expect(recovered.connection.availability).toEqual({ status: 'available', observedAt: 4000 })
        expect(recovered.project.resource).toMatchObject({
          kind: 'current-readable',
          observation: { observedAt: 4000 },
        })
        expect(recovered.project.maps.map((map) => publicMapObservation(map)?.value)).toEqual(
          successfulMaps,
        )
        const afterRecovery = test.states.length
        const remoteReadCount = test.providerReads.length

        test.at(5000, 'complete')
        test.updateLocal()
        const unrelated = readApplicationState(test.application.current())
        expect(unrelated.projects.find((value) => value.ref.projectId === LOCAL.id)).toMatchObject({
          resource: { kind: 'current-readable', observation: { observedAt: 5000 } },
        })
        const localProject = unrelated.projects.find((value) => value.ref.projectId === LOCAL.id)
        expect(localProject && publicProjectObservation(localProject)?.value.name).toBe(
          'Local changed independently',
        )
        expect(unrelated.capturedAt).toBe(5000)
        expect(test.providerReads).toHaveLength(remoteReadCount)
        expect(remoteState(unrelated).connection.availability.observedAt).toBe(4000)
        expect(publicProjectObservation(remoteState(unrelated).project)?.observedAt).toBe(4000)
        for (const published of test.states.slice(afterRecovery)) {
          expect(remoteState(published).connection.availability.observedAt).toBe(4000)
          expect(publicProjectObservation(remoteState(published).project)?.observedAt).toBe(4000)
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
      const state = readApplicationState(test.application.current())
      const { connection, project } = remoteState(state)
      expect(connection.availability).toEqual({ status: 'available', observedAt: 1000 })
      expect(project.resource).toMatchObject({
        kind: 'current-readable',
        observation: { observedAt: 1000 },
      })
      expect(project.maps[0]).toMatchObject({
        ref: fixtureResourceRef({ project: REMOTE, mapId: '108' }),
        resource: { kind: 'current-readable' },
        ticketsMembership: { kind: 'current-incomplete' },
      })
      expect(project.activeMap).toMatchObject({ kind: 'uncertain', reason: 'map-incomplete' })
      expectConfiguredFacts(state)
    } finally {
      await test.application.stop()
    }
  })

  // Catches content deduplication hiding a real read and later publication/failure inventing freshness.
  it('advances every identical successful resource read and retains only the actual last-success time', async () => {
    const test = fixture('complete')
    try {
      await test.application.start()
      for (const time of [2000, 3000, 4000]) {
        test.at(time, 'complete')
        expect((await test.refresh()).ok).toBe(true)
        expect(remoteState(readApplicationState(test.application.current())).project).toMatchObject(
          {
            resource: {
              kind: 'current-readable',
              observation: {
                attemptedAt: time,
                observedAt: time,
                provenance: {
                  integration: 'github',
                  connectionId: 'work',
                  repositoryId: '42',
                  stage: 'repository',
                },
                value: {
                  source: {
                    integration: 'github',
                    repositoryId: '42',
                    nameWithOwner: 'Acme/Roadmap',
                    url: 'https://github.com/Acme/Roadmap',
                  },
                },
              },
            },
            maps: [
              {
                ref: fixtureResourceRef({ project: REMOTE, mapId: '108' }),
                resource: {
                  kind: 'current-readable',
                  observation: {
                    attemptedAt: time,
                    observedAt: time,
                    provenance: {
                      integration: 'github',
                      connectionId: 'work',
                      repositoryId: '42',
                      stage: 'map-read',
                    },
                    value: {
                      body: { raw: '## Destination\n\nKeep truthful source observation time.\n' },
                    },
                  },
                },
              },
            ],
          },
        )
      }
      test.at(5000, 'transient')
      expect((await test.refresh()).ok).toBe(true)
      expect(remoteState(readApplicationState(test.application.current())).project).toMatchObject({
        resource: {
          kind: 'retained-unavailable',
          lastSuccessful: { observedAt: 4000 },
          unavailable: {
            scope: { kind: 'project', project: fixtureResourceRef(REMOTE) },
            attemptedAt: 5000,
            failure: { kind: 'transient', cause: 'network' },
          },
        },
        maps: [
          {
            resource: {
              kind: 'retained-unavailable',
              lastSuccessful: { observedAt: 4000 },
              unavailable: {
                scope: { kind: 'project', project: fixtureResourceRef(REMOTE) },
                attemptedAt: 5000,
              },
            },
          },
        ],
      })
      test.at(6000, 'transient')
      test.updateLocal()
      expect(test.application.current().capturedAt).toBe(6000)
      expect(remoteState(readApplicationState(test.application.current())).project).toMatchObject({
        resource: {
          kind: 'retained-unavailable',
          lastSuccessful: { observedAt: 4000 },
          unavailable: { attemptedAt: 5000 },
        },
        maps: [
          {
            resource: {
              kind: 'retained-unavailable',
              lastSuccessful: { observedAt: 4000 },
              unavailable: { attemptedAt: 5000 },
            },
          },
        ],
      })
    } finally {
      await test.application.stop()
    }
  })

  // Catches a readable incomplete child changing the Project metadata's own read phase or time.
  it('keeps parent metadata and incomplete map membership freshness independently scoped', async () => {
    const test = fixture('incomplete')
    try {
      await test.application.start()
      expect(remoteState(readApplicationState(test.application.current())).project).toMatchObject({
        resource: {
          kind: 'current-readable',
          observation: { observedAt: 1000, completeness: { kind: 'complete' } },
        },
        activeMap: { kind: 'uncertain' },
        maps: [
          {
            resource: {
              kind: 'current-readable',
              observation: {
                observedAt: 1000,
                value: {
                  body: { raw: '## Destination\n\nKeep truthful source observation time.\n' },
                  progress: { total: 0, completed: 0 },
                },
              },
            },
            ticketsMembership: {
              kind: 'current-incomplete',
              observation: {
                observedAt: 1000,
                completeness: { kind: 'incomplete', reason: 'pagination' },
              },
              lastComplete: null,
            },
            tickets: [],
          },
        ],
      })
    } finally {
      await test.application.stop()
    }
  })
})

describe('successful source health refinement', () => {
  const read = createSourceFixtureOwner()
  const baseline: SourceContribution = {
    project: LOCAL,
    attempts: read([localContent('Known source')], 1000).attempts,
    health: { status: 'available', observedAt: 1000 },
  }
  const failure: SourceContribution = {
    project: LOCAL,
    attempts: [
      {
        kind: 'failed',
        readSequence: read.nextReadSequence(),
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
          ? {
              ...attempt,
              readSequence: read.nextReadSequence(),
              attemptedAt: 2000,
              observedAt: 2000,
            }
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
      readSequence: read.nextReadSequence(),
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
                readSequence: read.nextReadSequence(),
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
