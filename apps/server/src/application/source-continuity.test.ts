import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ApplicationState, ProjectKey } from '@roadmap/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangeEvent } from '../change-feed.ts'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { type CredentialBundle, createGitHubConnectionPort } from '../github/connections.ts'
import type { RawMapIssue } from '../github/map-query.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type { GitHubObservationInput, LocalObservationInput } from '../observation/coordinator.ts'
import type { SourceContribution } from '../observation/source.ts'
import type {
  GitHubConnection,
  GitHubProjectIntent,
  GitHubProviderRead,
  ProjectConfiguration,
} from '../projects/registry.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const execFileAsync = promisify(execFile)
const LOCAL: ProjectKey = { integration: 'local', id: 'saved-local' }
const SOURCE_A: ProjectKey = { integration: 'github', id: 'saved-source-a' }
const SOURCE_B: ProjectKey = { integration: 'github', id: 'saved-source-b' }
const CONNECTION_A: GitHubConnection = {
  id: 'connection-a',
  integration: 'github',
  name: 'Account A',
  builtIn: false,
  githubIdentity: { id: '42', login: 'account-a' },
}
const CONNECTION_B: GitHubConnection = {
  id: 'connection-b',
  integration: 'github',
  name: 'Account B',
  builtIn: false,
  githubIdentity: { id: '77', login: 'account-b' },
}
const CREDENTIALS_A: CredentialBundle = {
  accessToken: 'harmless-source-a-token',
  refreshToken: 'harmless-source-a-refresh',
  accessTokenExpiresAt: Date.now() + 10_000_000,
  refreshTokenExpiresAt: Date.now() + 100_000_000,
}
const CREDENTIALS_B: CredentialBundle = {
  accessToken: 'harmless-source-b-token',
  refreshToken: 'harmless-source-b-refresh',
  accessTokenExpiresAt: Date.now() + 10_000_000,
  refreshTokenExpiresAt: Date.now() + 100_000_000,
}
const PROJECT_A: GitHubProjectIntent = {
  ref: { integration: 'github', projectId: SOURCE_A.id },
  connectionId: CONNECTION_A.id,
  locator: { repositoryId: '101', nameWithOwner: 'acme/configured-a-hint' },
  workspace: { path: join(tmpdir(), 'roadmap-source-continuity-missing-a') },
}
const PROJECT_B: GitHubProjectIntent = {
  ref: { integration: 'github', projectId: SOURCE_B.id },
  connectionId: CONNECTION_B.id,
  locator: { repositoryId: '202', nameWithOwner: 'acme/configured-b-hint' },
  workspace: { path: join(tmpdir(), 'roadmap-source-continuity-missing-b') },
}
const CONFIGURATION: ProjectConfiguration = {
  schemaVersion: 6,
  configurationVersion: 1,
  connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }, CONNECTION_A],
  projects: [PROJECT_A],
  automation: { enabled: false, enabledProjects: [] },
}

function rawMap(nameWithOwner: string, body: string, claimed = false): RawMapIssue {
  const assignees = claimed
    ? [
        {
          login: 'harmless-session',
          avatarUrl: 'https://github.com/harmless-session.png',
          url: 'https://github.com/harmless-session',
        },
      ]
    : []
  return {
    number: 108,
    title: 'Source map',
    url: `https://github.com/${nameWithOwner}/issues/108`,
    state: 'OPEN',
    updatedAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    body: `## Destination\n\n${body}\n`,
    subIssuesSummary: { total: 1, completed: 0, percentCompleted: 0 },
    subIssues: {
      totalCount: 1,
      pageInfo: { hasNextPage: false },
      nodes: [
        {
          number: 109,
          title: 'Source ticket',
          url: `https://github.com/${nameWithOwner}/issues/109`,
          state: 'OPEN',
          stateReason: null,
          createdAt: '2026-09-01T00:00:00Z',
          closedAt: null,
          body,
          labels: {
            totalCount: 1,
            pageInfo: { hasNextPage: false },
            nodes: [{ name: 'wayfinder:task', color: 'ffffff' }],
          },
          assignees: {
            totalCount: assignees.length,
            pageInfo: { hasNextPage: false },
            nodes: assignees,
          },
          blockedBy: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
        },
      ],
    },
  }
}

function readGate() {
  const started = Promise.withResolvers<void>()
  const completion = Promise.withResolvers<void>()
  let pending = true
  return {
    started: started.promise,
    pending: () => pending,
    async enter() {
      started.resolve()
      await completion.promise
    },
    release() {
      pending = false
      completion.resolve()
    },
  }
}

function fixture(
  initial: ProjectConfiguration = CONFIGURATION,
  actualWorkspaces = false,
  observeLocal = false,
) {
  let configuration = initial
  const listeners = new Set<(read: ConfigurationRead) => void>()
  const writes: ProjectConfiguration[] = []
  function emit(next: ProjectConfiguration) {
    configuration = next
    for (const listener of listeners) listener({ ok: true, document: next })
  }
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: configuration }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next) {
      writes.push(next)
      emit(next)
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {},
  }
  const gates: ReturnType<typeof readGate>[] = []
  const repositories: Array<{
    id: string
    nameWithOwner: string
    credentials: CredentialBundle
    identity: GitHubConnection['githubIdentity']
    map: RawMapIssue
    identityGate: ReturnType<typeof readGate> | null
    mapGate: ReturnType<typeof readGate> | null
    inFlight: number
    maximumInFlight: number
  }> = [
    {
      id: '101',
      nameWithOwner: 'acme/source-a',
      credentials: CREDENTIALS_A,
      identity: CONNECTION_A.githubIdentity,
      map: rawMap('acme/source-a', 'A baseline body'),
      identityGate: null,
      mapGate: null,
      inFlight: 0,
      maximumInFlight: 0,
    },
    {
      id: '202',
      nameWithOwner: 'acme/source-b',
      credentials: CREDENTIALS_B,
      identity: CONNECTION_B.githubIdentity,
      map: rawMap('acme/source-b', 'B candidate body', true),
      identityGate: null,
      mapGate: null,
      inFlight: 0,
      maximumInFlight: 0,
    },
  ]
  function repository(id: string) {
    const result = repositories.find((value) => value.id === id)
    if (!result) throw new Error(`Unexpected fixture repository ${id}`)
    return result
  }
  const requests: Array<{ repositoryId: string; path: string; token: string; at: number }> = []
  async function request<T>(
    accessToken: () => Promise<string>,
    path: string,
    read: (value: ReturnType<typeof repository>) => Promise<T>,
  ): Promise<T> {
    const token = await accessToken()
    const authorized = repositories.find((value) => value.credentials.accessToken === token)
    if (!authorized) throw new Error('Provider request lacks current Connection-bound credentials')
    requests.push({ repositoryId: authorized.id, path, token, at: Date.now() })
    authorized.inFlight += 1
    authorized.maximumInFlight = Math.max(authorized.maximumInFlight, authorized.inFlight)
    try {
      return await read(authorized)
    } finally {
      authorized.inFlight -= 1
    }
  }
  function providerRead(accessToken: () => Promise<string>): GitHubProviderRead {
    return {
      restGet: (path) =>
        request(accessToken, path, async (value) => {
          if (path === `/repositories/${value.id}`) {
            await value.identityGate?.enter()
            return { id: Number(value.id), full_name: value.nameWithOwner }
          }
          if (path === `/repos/${value.nameWithOwner}`)
            return { id: Number(value.id), full_name: value.nameWithOwner }
          if (
            path ===
            `/repos/${value.nameWithOwner}/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1`
          )
            return [{ number: 108 }]
          throw new Error(`Unexpected Connection-bound repository request ${path}`)
        }),
      graphql: (_query, variables = {}) =>
        request(accessToken, 'map-read', async (value) => {
          const [owner, name] = value.nameWithOwner.split('/')
          if (variables.o0 !== owner || variables.n0 !== name || variables.i0 !== 108)
            throw new Error('GraphQL request does not match the current Connection repository')
          // Capture the provider response before blocking, so later polls read later content.
          const map = value.map
          await value.mapGate?.enter()
          return {
            data: {
              rateLimit: { cost: 1, remaining: 5000, limit: 5000, resetAt: '2027-01-01T00:00:00Z' },
              m0: { databaseId: Number(value.id), nameWithOwner: value.nameWithOwner, issue: map },
            },
            errors: [],
          }
        }),
    }
  }
  const github = createGitHubConnectionPort({
    clientId: 'harmless-client',
    appSlug: 'harmless-app',
    now: Date.now,
    fetch: async (input, init) => {
      if (String(input) !== 'https://api.github.com/user')
        throw new Error('This fixture does not authorize devices or refresh credentials')
      const token = new Headers(init?.headers).get('Authorization')
      const account = repositories.find(
        (value) => `Bearer ${value.credentials.accessToken}` === token,
      )
      if (!account) throw new Error('Unexpected account-validation credential')
      return Response.json({ id: Number(account.identity.id), login: account.identity.login })
    },
  })
  const pool = createGitHubObserverPool({ now: Date.now, logger: { warn() {} } })
  const localInputs: LocalObservationInput[] = []
  const inputs: GitHubObservationInput[] = []
  const callbacks: Array<{
    repositoryId: string
    projectId: string
    hold: boolean
    retired: boolean
    replay(): void
  }> = []
  const events: ChangeEvent[] = []
  const states: ApplicationState[] = []
  const launches: Array<{ executable: string; args: readonly string[] }> = []
  const application = createRoadmapApplication({
    configuration: document,
    github,
    providerRead,
    now: Date.now,
    credentialVault: {
      async read(connectionId) {
        if (connectionId === CONNECTION_A.id) return CREDENTIALS_A
        if (connectionId === CONNECTION_B.id) return CREDENTIALS_B
        throw new Error('Unexpected credential Connection')
      },
      async write() {
        throw new Error('Saved credentials must not change in this fixture')
      },
      async delete() {
        throw new Error('Saved credentials must not be deleted in this fixture')
      },
      async cleanupOrphans() {},
    },
    admissions: {
      local: createLocalProjectAdmission(),
      github: actualWorkspaces
        ? createGitHubProjectAdmission()
        : createGitHubProjectAdmission({
            async inspectWorkspace() {
              throw new Error('No host worktree is required for remote observation')
            },
          }),
    },
    operations: createApplicationOperations({
      async launch(executable, args) {
        launches.push({ executable, args })
      },
      async selectWorkspace() {
        throw new Error('This fixture must not open a host folder selector')
      },
    }),
    observers: {
      local(input) {
        localInputs.push(input)
        if (observeLocal)
          return createLocalObserver(input, {
            now: Date.now,
            watchDirectory: () => ({ close() {} }),
            logger: { info() {}, warn() {} },
          })
        throw new Error('A colliding Local Workspace must not receive source authority')
      },
      github(input) {
        inputs.push(input)
        const observer = pool.create(input)
        let last: SourceContribution | null = null
        let callback: ((value: SourceContribution) => void) | null = null
        const captured = {
          repositoryId: input.source.repositoryId,
          projectId: input.ref.projectId,
          hold: false,
          retired: false,
          replay() {
            if (!last || !callback) throw new Error('No actual provider contribution was captured')
            callback(last)
          },
        }
        callbacks.push(captured)
        return {
          observe: () => observer.observe(),
          subscribe(listener) {
            callback = listener
            return observer.subscribe((value) => {
              last = value
              if (!captured.hold) listener(value)
            })
          },
          refresh: () => observer.refresh(),
          async stop() {
            captured.retired = true
            await observer.stop()
          },
        }
      },
      reconcileGitHubTopology: (values) => pool.reconcileTopology(values),
      stop: () => pool.stop(),
    },
    onChangeEvents: (batch) => events.push(...batch),
  })
  const unsubscribe = application.subscribe((state) => states.push(state))
  return {
    application,
    emit,
    requests,
    writes,
    localInputs,
    inputs,
    callbacks,
    events,
    states,
    launches,
    update(id: string, body: string, claimed = false) {
      const value = repository(id)
      value.map = rawMap(value.nameWithOwner, body, claimed)
    },
    gate(id: string, stage: 'identity' | 'map') {
      const gate = readGate()
      gates.push(gate)
      const value = repository(id)
      if (stage === 'identity') value.identityGate = gate
      else value.mapGate = gate
      return gate
    },
    maximumInFlight: (id: string) => repository(id).maximumInFlight,
    async stop() {
      for (const gate of gates) gate.release()
      unsubscribe()
      await application.stop()
    },
  }
}

function project(state: ApplicationState, key: ProjectKey) {
  const value = state.projects.find(
    (row) => row.key.integration === key.integration && row.key.id === key.id,
  )
  if (!value) throw new Error('Configured Project identity disappeared')
  return value
}

function expectOnlyActiveA(state: ApplicationState) {
  expect(state.configurationVersion).toBe(1)
  expect(state.configuration.valid).toBe(true)
  expect(state.registrations.map((row) => row.key)).toEqual([SOURCE_A])
  expect(state.projects.map((row) => row.key)).toEqual([SOURCE_A])
  expect(state.connections.map((row) => row.id)).toEqual(['local', 'connection-a'])
  expect(state.registrations[0]).toMatchObject({
    connectionId: 'connection-a',
    locator: {
      integration: 'github',
      repositoryId: '101',
      nameWithOwner: 'acme/configured-a-hint',
    },
    workspace: { path: PROJECT_A.workspace.path, gitIdentity: '101' },
  })
  expect(state.roadmap.projects.map((row) => row.key)).toEqual([SOURCE_A])
  expect(JSON.stringify(state)).not.toContain('B candidate body')
  expect(JSON.stringify(state)).not.toContain(CREDENTIALS_A.accessToken)
  expect(JSON.stringify(state)).not.toContain(CREDENTIALS_B.accessToken)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RoadmapApplication independent source continuity', () => {
  it.each(['manual refresh', 'ordinary recovery'])(
    'admits a restored saved canonical Local root through %s without refreshing GitHub provenance',
    async (recovery) => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)
      const root = await mkdtemp(join(tmpdir(), 'roadmap-restored-local-'))
      const workspace = join(await realpath(root), 'saved-root')
      await mkdir(workspace)
      const canonical = await realpath(workspace)
      await rm(workspace, { recursive: true })
      const local = {
        ref: { integration: 'local', projectId: LOCAL.id },
        connectionId: 'local',
        displayName: 'Saved Local management',
        workspace: { path: canonical },
      } satisfies ProjectConfiguration['projects'][number]
      const test = fixture({ ...CONFIGURATION, projects: [local, PROJECT_A] }, false, true)
      try {
        await test.application.start()
        const before = test.application.current()
        expect(project(before, LOCAL).availability).toMatchObject({ status: 'unavailable' })
        expect(project(before, LOCAL).availability.observedAt).toBeUndefined()
        expect(test.localInputs).toEqual([])
        expect(project(before, SOURCE_A).availability.observedAt).toBe(1_000)
        await mkdir(join(workspace, '.wayfinder'), { recursive: true })
        expect(await realpath(workspace)).toBe(canonical)
        if (recovery === 'manual refresh') {
          vi.setSystemTime(3_000)
          expect(
            await test.application.execute({
              type: 'refresh-project',
              project: LOCAL,
              expectedConfigurationVersion: 1,
            }),
          ).toMatchObject({ ok: true, result: { type: 'project-refreshed', project: LOCAL } })
        } else {
          await vi.advanceTimersByTimeAsync(2_000)
          await vi.waitFor(() =>
            expect(project(test.application.current(), LOCAL).availability.status).toBe(
              'available',
            ),
          )
        }
        const after = test.application.current()
        expect(after.configurationVersion).toBe(1)
        expect(after.registrations).toEqual(before.registrations)
        expect(after.registrations.find((row) => row.key.id === LOCAL.id)).toMatchObject({
          key: LOCAL,
          connectionId: 'local',
          displayName: 'Saved Local management',
          workspace: { path: canonical },
          locator: { integration: 'local', path: canonical },
        })
        expect(project(after, LOCAL)).toMatchObject({
          name: 'Saved Local management',
          availability: { status: 'available' },
          openMaps: [],
          closedMaps: [],
        })
        expect(project(after, LOCAL).availability.observedAt).toBeGreaterThanOrEqual(3_000)
        expect(project(after, LOCAL).availability.observedAt).toBeLessThanOrEqual(13_000)
        expect(project(after, SOURCE_A)).toEqual(project(before, SOURCE_A))
        expect(test.localInputs).toHaveLength(1)
        expect(test.localInputs[0]).toMatchObject({
          integration: 'local',
          ref: local.ref,
          workspace: { path: canonical },
        })
        expect(Object.keys(test.localInputs[0] ?? {}).sort()).toEqual([
          'integration',
          'ref',
          'workspace',
        ])
        expect(test.inputs).toHaveLength(1)
        expect(test.callbacks[0]?.retired).toBe(false)
        expect(test.requests.filter((request) => request.path === 'map-read')).toHaveLength(1)
        expect(test.writes).toEqual([])
        expect(test.launches).toEqual([])
        // After admission, Local observation owns cadence. There is no coordinator reproof poller.
        const published = test.states.length
        await vi.advanceTimersByTimeAsync(10_000)
        expect(test.localInputs).toHaveLength(1)
        expect(test.states).toHaveLength(published)
      } finally {
        try {
          await test.stop()
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    },
  )

  it.each([undefined, 'recorded-history'])(
    'denies rebound saved Local canonical roots without matching identity proof, %s',
    async (gitIdentity) => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)
      const root = await mkdtemp(join(tmpdir(), 'roadmap-rebound-local-'))
      const canonicalRoot = await realpath(root)
      const workspace = join(canonicalRoot, 'saved-root')
      const unrelated = join(canonicalRoot, 'unrelated-root')
      await mkdir(join(unrelated, '.wayfinder'), { recursive: true })
      const local = {
        ref: { integration: 'local', projectId: LOCAL.id },
        connectionId: 'local',
        displayName: 'Saved Local management',
        workspace: { path: workspace, ...(gitIdentity ? { gitIdentity } : {}) },
      } satisfies ProjectConfiguration['projects'][number]
      const test = fixture({ ...CONFIGURATION, projects: [local, PROJECT_A] }, false, true)
      try {
        await test.application.start()
        const before = test.application.current()
        await symlink(unrelated, workspace, 'dir')
        expect(await realpath(workspace)).toBe(unrelated)
        expect(
          await test.application.execute({
            type: 'refresh-project',
            project: LOCAL,
            expectedConfigurationVersion: 1,
          }),
        ).toMatchObject({ ok: false })
        await vi.advanceTimersByTimeAsync(10_000)
        expect(project(test.application.current(), LOCAL).availability.status).toBe('unavailable')
        expect(project(test.application.current(), LOCAL).availability.observedAt).toBeUndefined()
        expect(test.application.current().registrations).toEqual(before.registrations)
        expect(project(test.application.current(), SOURCE_A)).toEqual(project(before, SOURCE_A))
        expect(test.localInputs).toEqual([])
        expect(test.inputs).toHaveLength(1)
        expect(test.writes).toEqual([])
        expect(test.launches).toEqual([])
      } finally {
        try {
          await test.stop()
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    },
  )

  it.each(['local-first', 'github-first'])(
    'keeps actual GitHub observation when saved canonical Workspaces collide, %s',
    async (order) => {
      const root = await mkdtemp(join(tmpdir(), 'roadmap-source-continuity-'))
      let test: ReturnType<typeof fixture> | null = null
      try {
        const worktree = join(await realpath(root), 'worktree')
        const alias = join(await realpath(root), 'alias')
        await mkdir(worktree)
        await execFileAsync('git', ['-C', worktree, 'init', '--quiet'])
        await execFileAsync('git', [
          '-C',
          worktree,
          'remote',
          'add',
          'origin',
          'https://github.com/acme/source-a.git',
        ])
        await symlink(worktree, alias, 'dir')
        expect(await realpath(alias)).toBe(worktree)
        const local = {
          ref: { integration: 'local', projectId: LOCAL.id },
          connectionId: 'local',
          displayName: 'Saved Local',
          workspace: { path: worktree },
        } satisfies ProjectConfiguration['projects'][number]
        const remote: GitHubProjectIntent = {
          ...PROJECT_A,
          displayName: 'Saved GitHub',
          workspace: { path: alias },
        }
        const configured: ProjectConfiguration = {
          ...CONFIGURATION,
          projects: order === 'local-first' ? [local, remote] : [remote, local],
        }
        test = fixture(configured, true)
        await test.application.start()
        const state = test.application.current()
        expect(state.configurationVersion).toBe(1)
        expect(state.configuration.valid).toBe(true)
        expect(state.registrations).toHaveLength(2)
        expect(state.registrations.find((row) => row.key.id === LOCAL.id)).toMatchObject({
          key: LOCAL,
          connectionId: 'local',
          displayName: 'Saved Local',
          workspace: { path: worktree },
          locator: { integration: 'local', path: worktree },
        })
        expect(state.registrations.find((row) => row.key.id === SOURCE_A.id)).toMatchObject({
          key: SOURCE_A,
          connectionId: 'connection-a',
          displayName: 'Saved GitHub',
          workspace: { path: alias, gitIdentity: '101' },
          locator: {
            integration: 'github',
            repositoryId: '101',
            nameWithOwner: 'acme/configured-a-hint',
          },
        })
        expect(state.connections.find((row) => row.id === 'connection-a')).toMatchObject({
          name: 'Account A',
          githubIdentity: { id: '42', login: 'account-a' },
        })
        for (const key of [LOCAL, SOURCE_A]) {
          expect(
            project(state, key).actions.some((action) => action.kind === 'server-launch'),
          ).toBe(false)
        }
        expect(test.localInputs).toEqual([])
        expect(project(state, LOCAL)).toMatchObject({
          availability: { status: 'unavailable' },
          openMaps: [],
          closedMaps: [],
        })
        expect(state.roadmap.projects.some((row) => row.key.integration === 'local')).toBe(false)
        expect(project(state, SOURCE_A)).toMatchObject({
          name: 'Saved GitHub',
          availability: { status: 'available' },
          openMaps: [
            { id: '108', ticketsComplete: true, tickets: [{ id: '109', body: 'A baseline body' }] },
          ],
        })
        expect(
          state.connections.find((row) => row.id === 'connection-a')?.availability.status,
        ).toBe('available')
        expect(test.inputs).toHaveLength(1)
        expect(test.inputs[0]?.source).toMatchObject({
          connectionId: 'connection-a',
          accountId: '42',
          repositoryId: '101',
        })
        expect(test.requests).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: '/repos/acme/source-a',
              token: 'harmless-source-a-token',
            }),
            expect.objectContaining({
              path: '/repositories/101',
              token: 'harmless-source-a-token',
            }),
            expect.objectContaining({ path: 'map-read', token: 'harmless-source-a-token' }),
          ]),
        )
        test.update('101', 'Remote body after occupancy rejection', true)
        expect(
          await test.application.execute({
            type: 'refresh-project',
            project: SOURCE_A,
            expectedConfigurationVersion: 1,
          }),
        ).toMatchObject({ ok: true, result: { type: 'project-refreshed', project: SOURCE_A } })
        expect(project(test.application.current(), SOURCE_A).openMaps[0]?.tickets[0]).toMatchObject(
          {
            body: 'Remote body after occupancy rejection',
            isClaimed: true,
          },
        )
        expect(test.events.filter((event) => event.type === 'ticket-claimed')).toHaveLength(1)
        const eventsAfterRefresh = [...test.events]
        for (const key of [LOCAL, SOURCE_A]) {
          for (const actionId of ['open-workspace', 'open-terminal', 'reveal-source']) {
            expect(
              await test.application.execute({
                type: 'launch-action',
                project: key,
                actionId,
                expectedConfigurationVersion: 1,
              }),
            ).toMatchObject({
              ok: false,
              error: { code: 'admission-failed', field: 'workspace.path' },
            })
          }
        }
        const repairAlias = join(await realpath(root), 'repair-alias')
        await symlink(worktree, repairAlias, 'dir')
        const refreshed = test.application.current()
        for (const key of [LOCAL, SOURCE_A]) {
          expect(
            await test.application.execute({
              type: 'repair-project-workspace',
              project: key,
              workspace: { path: repairAlias },
              expectedConfigurationVersion: 1,
            }),
          ).toMatchObject({
            ok: false,
            error: { code: 'admission-failed', field: 'workspace.path' },
          })
        }
        const afterRepair = test.application.current()
        expect(afterRepair.configurationVersion).toBe(refreshed.configurationVersion)
        expect(afterRepair.configuration).toEqual(refreshed.configuration)
        expect(afterRepair.registrations).toEqual(refreshed.registrations)
        expect(afterRepair.connections).toEqual(refreshed.connections)
        expect(afterRepair.automation).toEqual(refreshed.automation)
        expect(afterRepair.roadmap.projects).toEqual(refreshed.roadmap.projects)
        expect(project(afterRepair, SOURCE_A).availability).toEqual(
          project(refreshed, SOURCE_A).availability,
        )
        for (const key of [LOCAL, SOURCE_A]) {
          expect(
            project(afterRepair, key).actions.some((action) => action.kind === 'server-launch'),
          ).toBe(false)
        }
        expect(test.events).toEqual(eventsAfterRefresh)
        expect(test.launches).toEqual([])
        expect(test.writes).toEqual([])
        expect(test.localInputs).toEqual([])
        expect(test.inputs).toHaveLength(1)
      } finally {
        try {
          await test?.stop()
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    },
  )

  it.each(['local-first', 'github-first'])(
    'reproves occupancy against a configured alias that starts resolving after activation, %s',
    async (order) => {
      const root = await mkdtemp(join(tmpdir(), 'roadmap-current-occupancy-'))
      let test: ReturnType<typeof fixture> | null = null
      try {
        const worktree = join(await realpath(root), 'worktree')
        const alias = join(await realpath(root), 'missing-alias')
        await mkdir(worktree)
        await execFileAsync('git', ['-C', worktree, 'init', '--quiet'])
        await execFileAsync('git', [
          '-C',
          worktree,
          'remote',
          'add',
          'origin',
          'https://github.com/acme/source-a.git',
        ])
        const local = {
          ref: { integration: 'local', projectId: LOCAL.id },
          connectionId: 'local',
          workspace: { path: alias },
        } satisfies ProjectConfiguration['projects'][number]
        const remote: GitHubProjectIntent = { ...PROJECT_A, workspace: { path: worktree } }
        test = fixture(
          {
            ...CONFIGURATION,
            projects: order === 'local-first' ? [local, remote] : [remote, local],
          },
          true,
        )
        await test.application.start()
        const before = test.application.current()
        expect(project(before, SOURCE_A).availability.observedAt).toBeTypeOf('number')
        expect(project(before, SOURCE_A)).toMatchObject({
          availability: { status: 'available' },
          openMaps: [{ id: '108', tickets: [{ id: '109', body: 'A baseline body' }] }],
        })
        expect(
          project(before, SOURCE_A).actions.some((action) => action.kind === 'server-launch'),
        ).toBe(true)
        expect(project(before, LOCAL).availability.status).toBe('unavailable')
        expect(test.localInputs).toEqual([])
        await symlink(worktree, alias, 'dir')
        for (const key of [SOURCE_A, LOCAL]) {
          for (const actionId of ['open-workspace', 'open-terminal', 'reveal-source']) {
            expect(
              await test.application.execute({
                type: 'launch-action',
                project: key,
                actionId,
                expectedConfigurationVersion: 1,
              }),
            ).toMatchObject({
              ok: false,
              error: { code: 'admission-failed', field: 'workspace.path' },
            })
          }
        }
        expect(test.launches).toEqual([])
        expect(test.writes).toEqual([])
        expect(test.localInputs).toEqual([])
        expect(test.inputs).toHaveLength(1)
        const after = test.application.current()
        expect(after.configurationVersion).toBe(before.configurationVersion)
        expect(after.configuration).toEqual(before.configuration)
        expect(after.registrations).toEqual(before.registrations)
        expect(after.connections).toEqual(before.connections)
        expect(after.automation).toEqual(before.automation)
        expect(after.authorizationOperations).toEqual(before.authorizationOperations)
        expect(after.projects.map((row) => row.key)).toEqual(before.projects.map((row) => row.key))
        expect(project(after, SOURCE_A).openMaps).toEqual(project(before, SOURCE_A).openMaps)
        expect(project(after, SOURCE_A).closedMaps).toEqual(project(before, SOURCE_A).closedMaps)
        expect(project(after, SOURCE_A).availability).toEqual(
          project(before, SOURCE_A).availability,
        )
        expect(after.roadmap.projects).toEqual(before.roadmap.projects)
        for (const key of [LOCAL, SOURCE_A]) {
          expect(project(after, key).name).toBe(project(before, key).name)
          expect(
            project(after, key).actions.some((action) => action.kind === 'server-launch'),
          ).toBe(false)
          expect(project(after, key).actions).toEqual(
            project(before, key).actions.filter((action) => action.kind !== 'server-launch'),
          )
        }
        expect(test.events).toEqual([])
      } finally {
        try {
          await test?.stop()
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    },
  )

  it('rejects a distinct case-only canonical Local directory without recorded Git history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-case-identity-'))
    const original = join(await realpath(root), 'Case')
    const candidate = join(await realpath(root), 'case')
    let configured: ProjectConfiguration = {
      ...CONFIGURATION,
      connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
      projects: [
        {
          ref: { integration: 'local', projectId: LOCAL.id },
          connectionId: 'local',
          displayName: 'Case-sensitive Local',
          workspace: { path: original },
        },
      ],
    }
    const listeners = new Set<(read: ConfigurationRead) => void>()
    const writes: ProjectConfiguration[] = []
    const application = createRoadmapApplication({
      configuration: {
        async load() {
          return { ok: true, document: configured }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        async write(next) {
          writes.push(next)
          configured = next
          for (const listener of listeners) listener({ ok: true, document: next })
          return { ok: true, durability: 'confirmed' }
        },
        async stop() {},
      },
      admissions: {
        local: createLocalProjectAdmission({
          async inspectWorkspace(path) {
            if (path === original)
              throw Object.assign(new Error('Unavailable directory'), { code: 'ENOENT' })
            if (path !== candidate) throw new Error('Unexpected Local inspection path')
            return { integration: 'local', path: candidate, readable: true, searchable: true }
          },
        }),
      },
      observers: {
        local: (input) => createLocalObserver(input, { logger: { info() {}, warn() {} } }),
        github() {
          throw new Error('No GitHub Project is configured')
        },
      },
    })
    try {
      await application.start()
      const before = application.current()
      expect(project(before, LOCAL).availability.status).toBe('unavailable')
      expect(
        await application.execute({
          type: 'repair-project-workspace',
          project: LOCAL,
          workspace: { path: candidate },
          expectedConfigurationVersion: 1,
        }),
      ).toMatchObject({ ok: false, error: { code: 'admission-failed', field: 'workspace.path' } })
      expect(writes).toEqual([])
      expect(application.current().configurationVersion).toBe(1)
      expect(application.current().registrations).toEqual(before.registrations)
      expect(application.current().registrations[0]).toMatchObject({
        key: LOCAL,
        workspace: { path: original },
        displayName: 'Case-sensitive Local',
      })
      expect(application.current().roadmap).toEqual(before.roadmap)
    } finally {
      try {
        await application.stop()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('polls active A while candidate B on another Connection has an unresolved actual provider baseline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const test = fixture()
    const candidate = test.gate('202', 'identity')
    try {
      await test.application.start()
      expectOnlyActiveA(test.application.current())
      expect(project(test.application.current(), SOURCE_A).openMaps[0]?.tickets[0]?.body).toBe(
        'A baseline body',
      )
      expect(test.events).toEqual([])
      const afterBaseline = test.states.length
      test.emit({
        ...CONFIGURATION,
        configurationVersion: 2,
        connections: [...CONFIGURATION.connections, CONNECTION_B],
        projects: [PROJECT_A, PROJECT_B],
      })
      await candidate.started
      expect(candidate.pending()).toBe(true)
      test.update('101', 'A changed while B is pending', true)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(candidate.pending()).toBe(true)
      const current = test.application.current()
      expectOnlyActiveA(current)
      expect(project(current, SOURCE_A)).toMatchObject({
        availability: { status: 'available', observedAt: 31_000 },
        openMaps: [
          {
            id: '108',
            body: { destination: 'A changed while B is pending' },
            tickets: [{ id: '109', body: 'A changed while B is pending', isClaimed: true }],
          },
        ],
      })
      expect(current.connections.find((row) => row.id === 'connection-a')?.availability).toEqual({
        status: 'available',
        observedAt: 31_000,
      })
      expect(test.events.filter((event) => event.type === 'ticket-claimed')).toEqual([
        {
          type: 'ticket-claimed',
          ticket: expect.objectContaining({ project: SOURCE_A, mapId: '108', id: '109' }),
        },
      ])
      for (const state of test.states.slice(afterBaseline)) expectOnlyActiveA(state)
      expect(test.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            repositoryId: '101',
            path: 'map-read',
            token: 'harmless-source-a-token',
            at: 31_000,
          }),
          expect.objectContaining({
            repositoryId: '202',
            path: '/repositories/202',
            token: 'harmless-source-b-token',
          }),
        ]),
      )
      candidate.release()
      await vi.advanceTimersByTimeAsync(0)
      expect(test.application.current().configurationVersion).toBe(2)
      expect(project(test.application.current(), SOURCE_A).openMaps[0]?.tickets[0]?.body).toBe(
        'A changed while B is pending',
      )
      expect(project(test.application.current(), SOURCE_B).openMaps[0]?.tickets[0]?.body).toBe(
        'B candidate body',
      )
      expect(test.events.filter((event) => event.type === 'ticket-claimed')).toHaveLength(1)
      expect(test.writes).toEqual([])
    } finally {
      await test.stop()
    }
  })

  it('serializes an active owner public refresh with its scheduled poll without dropping later content', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const test = fixture()
    try {
      await test.application.start()
      test.update('101', 'First gated A update', true)
      const gate = test.gate('101', 'map')
      const refresh = test.application.execute({
        type: 'refresh-project',
        project: SOURCE_A,
        expectedConfigurationVersion: 1,
      })
      await gate.started
      test.update('101', 'Newest serialized A update', true)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(gate.pending()).toBe(true)
      expect(test.maximumInFlight('101')).toBe(1)
      expect(project(test.application.current(), SOURCE_A).openMaps[0]?.tickets[0]?.body).toBe(
        'A baseline body',
      )
      expect(test.events).toEqual([])
      gate.release()
      expect(await refresh).toMatchObject({
        ok: true,
        result: { type: 'project-refreshed', project: SOURCE_A },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(test.maximumInFlight('101')).toBe(1)
      expect(project(test.application.current(), SOURCE_A).openMaps[0]?.tickets[0]).toMatchObject({
        body: 'Newest serialized A update',
        isClaimed: true,
      })
      expect(test.events.filter((event) => event.type === 'ticket-claimed')).toHaveLength(1)
    } finally {
      await test.stop()
    }
  })

  it('rejects a retired callback carrying an actual held GitHub contribution for a replaced public Project', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const test = fixture()
    try {
      await test.application.start()
      const original = test.callbacks.find((value) => value.repositoryId === '101')
      if (!original) throw new Error('Actual source A callback was not installed')
      original.hold = true
      test.update('101', 'Late retired A body', true)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(test.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ repositoryId: '101', path: 'map-read', at: 31_000 }),
        ]),
      )
      expect(project(test.application.current(), SOURCE_A).openMaps[0]?.tickets[0]?.body).toBe(
        'A baseline body',
      )
      test.emit({
        ...CONFIGURATION,
        configurationVersion: 2,
        connections: [...CONFIGURATION.connections, CONNECTION_B],
        projects: [{ ...PROJECT_B, ref: PROJECT_A.ref }],
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(test.application.current().configurationVersion).toBe(2)
      expect(original.retired).toBe(true)
      expect(project(test.application.current(), SOURCE_A)).toMatchObject({
        connectionId: 'connection-b',
        locator: { repositoryId: '202' },
        openMaps: [{ tickets: [{ id: '109', body: 'B candidate body' }] }],
      })
      const committed = test.application.current()
      const published = test.states.length
      const events = test.events.length
      // Replay the captured real callback, including its real stable-ID and Connection provenance.
      original.replay()
      expect(test.application.current()).toBe(committed)
      expect(test.states).toHaveLength(published)
      expect(test.events).toHaveLength(events)
      expect(project(test.application.current(), SOURCE_A).openMaps[0]?.tickets[0]?.body).toBe(
        'B candidate body',
      )
    } finally {
      await test.stop()
    }
  })
})
