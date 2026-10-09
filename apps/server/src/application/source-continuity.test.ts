import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { commandSchema } from '@roadmap/contracts/operations'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { decodeStateEnvelope } from '@roadmap/contracts/wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialBundle } from '../authorization/contracts.ts'
import type { ChangeEvent } from '../change-feed.ts'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { GitHubError } from '../github/client.ts'
import { createGitHubConnectionPort } from '../github/connections.ts'
import type { RawMapIssue } from '../github/map-query.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type { GitHubObservationInput, LocalObservationInput } from '../observation/coordinator.ts'
import type { SourceProjectKey as ProjectKey, SourceContribution } from '../observation/source.ts'
import type {
  GitHubConnection,
  GitHubProjectIntent,
  GitHubProviderRead,
  ProjectConfiguration,
} from '../projects/registry.ts'
import {
  fixtureProjectRef,
  fixtureResourceRef,
  fixtureTicketRef,
  readApplicationState,
} from '../public-test-fixtures.ts'
import {
  publicMapResource,
  publicProjectObservation,
  publicTicketObservation,
  publicTicketResource,
} from '../source-test-fixtures.ts'
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

function rawMap(
  nameWithOwner: string,
  body: string,
  claimed = false,
  blockedByB = false,
): RawMapIssue {
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
          blockedBy: {
            totalCount: blockedByB ? 1 : 0,
            pageInfo: { hasNextPage: false },
            nodes: blockedByB
              ? [
                  {
                    number: 109,
                    title: 'Blocker in B',
                    url: 'https://github.com/acme/source-b/issues/109',
                    state: 'OPEN',
                    repository: { databaseId: '202', nameWithOwner: 'acme/source-b' },
                  },
                ]
              : [],
          },
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
    siblingMap: RawMapIssue | null
    mapListed: boolean
    missingMapAlias: boolean
    repositoryUnavailable: boolean
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
      siblingMap: null,
      mapListed: true,
      missingMapAlias: false,
      repositoryUnavailable: false,
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
      siblingMap: null,
      mapListed: true,
      missingMapAlias: false,
      repositoryUnavailable: false,
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
            if (value.repositoryUnavailable)
              throw new GitHubError({ kind: 'transient', cause: 'network' })
            return { id: Number(value.id), full_name: value.nameWithOwner }
          }
          if (path === `/repos/${value.nameWithOwner}`)
            return { id: Number(value.id), full_name: value.nameWithOwner }
          if (
            path ===
            `/repos/${value.nameWithOwner}/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1`
          )
            return [
              ...(value.mapListed ? [{ number: 108 }] : []),
              ...(value.siblingMap ? [{ number: 110 }] : []),
            ]
          throw new Error(`Unexpected Connection-bound repository request ${path}`)
        }),
      graphql: (_query, variables = {}) =>
        request(accessToken, 'map-read', async (value) => {
          const [owner, name] = value.nameWithOwner.split('/')
          if (
            variables.o0 !== owner ||
            variables.n0 !== name ||
            variables.i0 !== (value.mapListed ? 108 : 110)
          )
            throw new Error('GraphQL request does not match the current Connection repository')
          if (
            value.mapListed &&
            value.siblingMap &&
            (variables.o1 !== owner || variables.n1 !== name || variables.i1 !== 110)
          )
            throw new Error(
              'Sibling GraphQL request does not match the current Connection repository',
            )
          // Capture the provider response before blocking, so later polls read later content.
          const map = value.mapListed ? value.map : value.siblingMap
          const missing = value.mapListed && value.missingMapAlias
          const sibling = value.siblingMap
          await value.mapGate?.enter()
          return {
            data: {
              rateLimit: { cost: 1, remaining: 5000, limit: 5000, resetAt: '2027-01-01T00:00:00Z' },
              ...(!missing
                ? {
                    m0: {
                      databaseId: Number(value.id),
                      nameWithOwner: value.nameWithOwner,
                      issue: map,
                    },
                  }
                : {}),
              ...(value.mapListed && sibling
                ? {
                    m1: {
                      databaseId: Number(value.id),
                      nameWithOwner: value.nameWithOwner,
                      issue: sibling,
                    },
                  }
                : {}),
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
    readonly latest: SourceContribution
    replay(): void
  }> = []
  const events: ChangeEvent[] = []
  const states: ReadyApplicationState[] = []
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
          get latest(): SourceContribution {
            if (!last) throw new Error('No actual provider contribution was captured')
            return last
          },
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
  const unsubscribe = application.subscribe((state) => states.push(readApplicationState(state)))
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
    blockOnB(id: string, body = 'A baseline body') {
      const value = repository(id)
      value.map = rawMap(value.nameWithOwner, body, false, true)
    },
    failRepository(id: string, unavailable: boolean) {
      repository(id).repositoryUnavailable = unavailable
    },
    addSibling(id: string) {
      const value = repository(id)
      value.siblingMap = {
        ...rawMap(value.nameWithOwner, 'Readable sibling body'),
        number: 110,
        url: `https://github.com/${value.nameWithOwner}/issues/110`,
        updatedAt: '2026-09-01T00:00:00Z',
      }
    },
    missingAlias(id: string, missing: boolean) {
      repository(id).missingMapAlias = missing
    },
    listMap(id: string, listed: boolean) {
      repository(id).mapListed = listed
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

function project(state: ReadyApplicationState, key: ProjectKey) {
  const value = state.projects.find(
    (row) => row.ref.integration === key.integration && row.ref.projectId === key.id,
  )
  if (!value) throw new Error('Configured Project identity disappeared')
  return value
}

function ticketObservation(state: ReadyApplicationState, key: ProjectKey) {
  const map = publicMapResource(project(state, key), '108')
  const ticket = map && publicTicketResource(map, '109')
  return ticket ? publicTicketObservation(ticket) : null
}

function expectOnlyActiveA(state: ReadyApplicationState) {
  expect(state.configurationVersion).toBe(1)
  expect(state.configuration.valid).toBe(true)
  expect(state.projects.map((row) => row.ref)).toEqual([fixtureProjectRef(SOURCE_A)])
  expect(state.connections.map((row) => row.id)).toEqual(['local', 'connection-a'])
  expect(state.projects[0]).toMatchObject({
    connectionId: 'connection-a',
    source: {
      integration: 'github',
      repositoryId: '101',
      nameWithOwner: 'acme/source-a',
    },
    management: { workspacePath: PROJECT_A.workspace.path },
  })
  expect(JSON.stringify(state)).not.toContain('B candidate body')
  expect(JSON.stringify(state)).not.toContain(CREDENTIALS_A.accessToken)
  expect(JSON.stringify(state)).not.toContain(CREDENTIALS_B.accessToken)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RoadmapApplication independent source continuity', () => {
  // Exercises coordinator.activate owner reuse, pool.reconcileTopology, and cached reproject.
  // A changed blocker reference at the same actual read time must not bypass parent failure.
  it('retains topology-corrected cached GitHub tickets without inventing a new source read', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const test = fixture()
    test.blockOnB('101')
    test.addSibling('101')
    const external = {
      kind: 'external',
      integration: 'github',
      repositoryId: '202',
      nameWithOwner: 'acme/source-b',
      ticketId: '109',
    }
    const registered = {
      kind: 'registered',
      ticket: fixtureResourceRef({ map: { project: SOURCE_B, mapId: '108' }, ticketId: '109' }),
    }
    const ownProvenance = {
      integration: 'github',
      connectionId: 'connection-a',
      repositoryId: '101',
      stage: 'map-read',
    }
    const parentFailure = (attemptedAt: number) => ({
      scope: { kind: 'project', project: fixtureProjectRef(SOURCE_A) },
      attemptedAt,
      provenance: {
        integration: 'github',
        connectionId: 'connection-a',
        repositoryId: '101',
        stage: 'repository',
      },
      failure: { kind: 'transient', cause: 'network' },
    })
    try {
      await test.application.start()
      const baseline = project(readApplicationState(test.application.current()), SOURCE_A)
      const ownerA = test.callbacks.find((owner) => owner.projectId === SOURCE_A.id)
      if (!ownerA) throw new Error('Missing actual A observer')
      const ownTicketRead = () => {
        const attempt = ownerA.latest.attempts.find(
          (value) =>
            value.kind === 'observed' &&
            value.scope.kind === 'ticket' &&
            value.scope.ticket.map.mapId === '108' &&
            value.scope.ticket.ticketId === '109',
        )
        if (!attempt || attempt.kind !== 'observed') throw new Error('Missing actual A ticket read')
        return attempt
      }
      const ownProjectFailure = () => {
        const attempt = ownerA.latest.attempts.find(
          (value) => value.kind === 'failed' && value.scope.kind === 'project',
        )
        if (!attempt || attempt.kind !== 'failed')
          throw new Error('Missing actual A Project failure')
        return attempt
      }
      const baselineRead = ownTicketRead()
      expect(baseline).toMatchObject({
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
        },
        displayOrder: {
          open: ['108', '110'].map((mapId) => fixtureResourceRef({ project: SOURCE_A, mapId })),
        },
      })
      const baselineMap = publicMapResource(baseline, '108')
      expect(baselineMap && publicTicketResource(baselineMap, '109')?.resource).toMatchObject({
        kind: 'current-readable',
        observation: {
          attemptedAt: 1000,
          observedAt: 1000,
          provenance: ownProvenance,
          value: { body: 'A baseline body', blockedBy: [{ reference: external }] },
        },
      })

      test.failRepository('101', true)
      vi.setSystemTime(2000)
      expect(
        await test.application.execute(
          commandSchema.parse({
            type: 'refresh-project',
            project: fixtureProjectRef(SOURCE_A),
            expectedConfigurationVersion: 1,
          }),
        ),
      ).toMatchObject({ ok: true })
      const failedRead = ownProjectFailure()
      expect(failedRead.readSequence).toBeGreaterThan(baselineRead.readSequence)
      expect(ownTicketRead().readSequence).toBe(baselineRead.readSequence)
      const unavailable = project(readApplicationState(test.application.current()), SOURCE_A)
      expect(unavailable).toMatchObject({
        resource: { kind: 'retained-unavailable', unavailable: parentFailure(2000) },
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: ['108', '110'].map((mapId) => fixtureResourceRef({ project: SOURCE_A, mapId })),
        },
      })
      const failedMap = publicMapResource(unavailable, '108')
      expect(failedMap && publicTicketResource(failedMap, '109')?.resource).toMatchObject({
        kind: 'retained-unavailable',
        unavailable: parentFailure(2000),
        lastSuccessful: {
          attemptedAt: 1000,
          observedAt: 1000,
          value: { blockedBy: [{ reference: external }] },
        },
      })
      const requestsBeforeTopology = test.requests.filter(
        (request) => request.repositoryId === '101',
      )

      vi.setSystemTime(3000)
      test.emit({
        ...CONFIGURATION,
        configurationVersion: 2,
        connections: [...CONFIGURATION.connections, CONNECTION_B],
        projects: [PROJECT_A, PROJECT_B],
      })
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(() =>
        expect(readApplicationState(test.application.current()).configurationVersion).toBe(2),
      )
      const reprojected = readApplicationState(test.application.current())
      const envelope: unknown = JSON.parse(JSON.stringify({ type: 'state', state: reprojected }))
      const decoded = decodeStateEnvelope(envelope)
      expect(decoded.ok).toBe(true)
      if (!decoded.ok)
        throw new Error('Cached topology reclassification invalidated outgoing state')
      expect(decoded.value.state).toEqual(reprojected)
      expect(ownTicketRead()).toMatchObject({
        readSequence: baselineRead.readSequence,
        attemptedAt: baselineRead.attemptedAt,
        observedAt: baselineRead.observedAt,
      })
      expect(ownProjectFailure()).toEqual(failedRead)
      const retained = project(reprojected, SOURCE_A)
      expect(retained).toMatchObject({
        resource: { kind: 'retained-unavailable', unavailable: parentFailure(2000) },
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: ['108', '110'].map((mapId) => fixtureResourceRef({ project: SOURCE_A, mapId })),
        },
      })
      const retainedMap = publicMapResource(retained, '108')
      expect(retainedMap && publicTicketResource(retainedMap, '109')?.resource).toMatchObject({
        kind: 'retained-unavailable',
        unavailable: parentFailure(2000),
        lastSuccessful: {
          attemptedAt: 1000,
          observedAt: 1000,
          provenance: ownProvenance,
          value: {
            body: 'A baseline body',
            blockedBy: [{ reference: registered }],
          },
        },
      })
      expect(project(reprojected, SOURCE_B).resource).toMatchObject({
        kind: 'current-readable',
        observation: { attemptedAt: 3000, observedAt: 3000 },
      })
      expect(test.requests.filter((request) => request.repositoryId === '101')).toEqual(
        requestsBeforeTopology,
      )
      expect(test.inputs.filter((input) => input.ref.projectId === SOURCE_A.id)).toHaveLength(1)
      expect(ownerA.retired).toBe(false)

      // A real later own read restores current evidence; identical cached data is not a read.
      test.failRepository('101', false)
      test.blockOnB('101', 'A newly fetched body')
      vi.setSystemTime(4000)
      expect(
        await test.application.execute(
          commandSchema.parse({
            type: 'refresh-project',
            project: fixtureProjectRef(SOURCE_A),
            expectedConfigurationVersion: 2,
          }),
        ),
      ).toMatchObject({ ok: true })
      const recoveredRead = ownTicketRead()
      expect(recoveredRead.readSequence).toBeGreaterThan(failedRead.readSequence)
      expect(
        ticketObservation(readApplicationState(test.application.current()), SOURCE_A),
      ).toMatchObject({
        attemptedAt: 4000,
        observedAt: 4000,
        provenance: ownProvenance,
        value: {
          body: 'A newly fetched body',
          blockedBy: [{ reference: registered }],
        },
      })
      const recoveredMap = publicMapResource(
        project(readApplicationState(test.application.current()), SOURCE_A),
        '108',
      )
      expect(recoveredMap && publicTicketResource(recoveredMap, '109')?.resource.kind).toBe(
        'current-readable',
      )
      expect(project(readApplicationState(test.application.current()), SOURCE_A).activeMap).toEqual(
        {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
        },
      )

      test.failRepository('101', true)
      vi.setSystemTime(5000)
      expect(
        await test.application.execute(
          commandSchema.parse({
            type: 'refresh-project',
            project: fixtureProjectRef(SOURCE_A),
            expectedConfigurationVersion: 2,
          }),
        ),
      ).toMatchObject({ ok: true })
      const laterFailure = ownProjectFailure()
      expect(laterFailure.readSequence).toBeGreaterThan(recoveredRead.readSequence)
      const readsBeforeRemoval = test.requests.filter((request) => request.repositoryId === '101')
      vi.setSystemTime(6000)
      test.emit({ ...CONFIGURATION, configurationVersion: 3 })
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(() =>
        expect(readApplicationState(test.application.current()).configurationVersion).toBe(3),
      )
      expect(ownTicketRead()).toMatchObject({
        readSequence: recoveredRead.readSequence,
        attemptedAt: recoveredRead.attemptedAt,
        observedAt: recoveredRead.observedAt,
      })
      expect(ownProjectFailure()).toEqual(laterFailure)
      const removed = project(readApplicationState(test.application.current()), SOURCE_A)
      const removedMap = publicMapResource(removed, '108')
      expect(removedMap && publicTicketResource(removedMap, '109')?.resource).toMatchObject({
        kind: 'retained-unavailable',
        unavailable: parentFailure(5000),
        lastSuccessful: {
          attemptedAt: 4000,
          observedAt: 4000,
          provenance: ownProvenance,
          value: {
            body: 'A newly fetched body',
            blockedBy: [{ reference: external }],
          },
        },
      })
      expect(removed.activeMap.kind).toBe('uncertain')
      expect(test.requests.filter((request) => request.repositoryId === '101')).toEqual(
        readsBeforeRemoval,
      )
      ownerA.replay()
      expect(project(readApplicationState(test.application.current()), SOURCE_A)).toEqual(removed)
      for (const state of test.states) {
        const published: unknown = JSON.parse(JSON.stringify({ type: 'state', state }))
        expect(decodeStateEnvelope(published).ok).toBe(true)
      }
      expect(test.launches).toEqual([])
      expect(test.writes).toEqual([])
    } finally {
      await test.stop()
    }
  })

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
        const before = readApplicationState(test.application.current())
        expect(project(before, LOCAL).resource.kind).toBe('never-observed')
        expect(publicProjectObservation(project(before, LOCAL))).toBeNull()
        expect(test.localInputs).toEqual([])
        expect(publicProjectObservation(project(before, SOURCE_A))?.observedAt).toBe(1_000)
        await mkdir(join(workspace, '.wayfinder'), { recursive: true })
        expect(await realpath(workspace)).toBe(canonical)
        if (recovery === 'manual refresh') {
          vi.setSystemTime(3_000)
          expect(
            await test.application.execute(
              commandSchema.parse({
                type: 'refresh-project',
                project: fixtureProjectRef(LOCAL),
                expectedConfigurationVersion: 1,
              }),
            ),
          ).toMatchObject({
            ok: true,
            result: { type: 'project-refreshed', project: fixtureProjectRef(LOCAL) },
          })
        } else {
          await vi.advanceTimersByTimeAsync(2_000)
          await vi.waitFor(() =>
            expect(
              project(readApplicationState(test.application.current()), LOCAL).resource.kind,
            ).toBe('current-readable'),
          )
        }
        const after = readApplicationState(test.application.current())
        expect(after.configurationVersion).toBe(1)
        expect(
          after.projects.map(({ ref, connectionId, source, management }) => ({
            ref,
            connectionId,
            source,
            management,
          })),
        ).toEqual(
          before.projects.map(({ ref, connectionId, source, management }) => ({
            ref,
            connectionId,
            source,
            management,
          })),
        )
        expect(after.projects.find((row) => row.ref.projectId === LOCAL.id)).toMatchObject({
          ref: fixtureResourceRef(LOCAL),
          connectionId: 'local',
          management: { displayName: 'Saved Local management' },
          source: { integration: 'local', path: canonical },
        })
        expect(project(after, LOCAL)).toMatchObject({
          name: 'Saved Local management',
          resource: { kind: 'current-readable' },
          maps: [],
          activeMap: { kind: 'known-empty' },
        })
        expect(publicProjectObservation(project(after, LOCAL))?.observedAt).toBeGreaterThanOrEqual(
          3_000,
        )
        expect(publicProjectObservation(project(after, LOCAL))?.observedAt).toBeLessThanOrEqual(
          13_000,
        )
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
        const before = readApplicationState(test.application.current())
        await symlink(unrelated, workspace, 'dir')
        expect(await realpath(workspace)).toBe(unrelated)
        expect(
          await test.application.execute(
            commandSchema.parse({
              type: 'refresh-project',
              project: fixtureProjectRef(LOCAL),
              expectedConfigurationVersion: 1,
            }),
          ),
        ).toMatchObject({ ok: false })
        await vi.advanceTimersByTimeAsync(10_000)
        expect(project(readApplicationState(test.application.current()), LOCAL).resource.kind).toBe(
          'never-observed',
        )
        expect(
          publicProjectObservation(
            project(readApplicationState(test.application.current()), LOCAL),
          ),
        ).toBeNull()
        expect(
          readApplicationState(test.application.current()).projects.map(
            ({ ref, connectionId, source, management }) => ({
              ref,
              connectionId,
              source,
              management,
            }),
          ),
        ).toEqual(
          before.projects.map(({ ref, connectionId, source, management }) => ({
            ref,
            connectionId,
            source,
            management,
          })),
        )
        expect(project(readApplicationState(test.application.current()), SOURCE_A)).toEqual(
          project(before, SOURCE_A),
        )
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
        const state = readApplicationState(test.application.current())
        expect(state.configurationVersion).toBe(1)
        expect(state.configuration.valid).toBe(true)
        expect(state.projects).toHaveLength(2)
        expect(state.projects.find((row) => row.ref.projectId === LOCAL.id)).toMatchObject({
          ref: fixtureResourceRef(LOCAL),
          connectionId: 'local',
          management: { displayName: 'Saved Local' },
          source: { integration: 'local', path: worktree },
        })
        expect(state.projects.find((row) => row.ref.projectId === SOURCE_A.id)).toMatchObject({
          ref: fixtureResourceRef(SOURCE_A),
          connectionId: 'connection-a',
          management: { workspacePath: alias, displayName: 'Saved GitHub' },
          source: {
            integration: 'github',
            repositoryId: '101',
            nameWithOwner: 'acme/source-a',
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
          resource: { kind: 'never-observed' },
          maps: [],
        })
        expect(project(state, SOURCE_A)).toMatchObject({
          name: 'Saved GitHub',
          resource: { kind: 'current-readable' },
          maps: [
            {
              ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
              ticketsMembership: { kind: 'current-complete' },
              tickets: [
                {
                  ref: fixtureResourceRef({
                    map: { project: SOURCE_A, mapId: '108' },
                    ticketId: '109',
                  }),
                  resource: {
                    kind: 'current-readable',
                    observation: { value: { body: 'A baseline body' } },
                  },
                },
              ],
            },
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
          await test.application.execute(
            commandSchema.parse({
              type: 'refresh-project',
              project: fixtureProjectRef(SOURCE_A),
              expectedConfigurationVersion: 1,
            }),
          ),
        ).toMatchObject({
          ok: true,
          result: { type: 'project-refreshed', project: fixtureProjectRef(SOURCE_A) },
        })
        expect(
          ticketObservation(readApplicationState(test.application.current()), SOURCE_A)?.value,
        ).toMatchObject({
          body: 'Remote body after occupancy rejection',
          isClaimed: true,
        })
        expect(test.events.filter((event) => event.type === 'ticket-claimed')).toHaveLength(1)
        const eventsAfterRefresh = [...test.events]
        for (const key of [LOCAL, SOURCE_A]) {
          for (const actionId of ['open-workspace', 'open-terminal', 'reveal-source']) {
            expect(
              await test.application.execute(
                commandSchema.parse({
                  type: 'launch-action',
                  project: fixtureProjectRef(key),
                  actionId,
                  expectedConfigurationVersion: 1,
                }),
              ),
            ).toMatchObject({
              ok: false,
              error: { code: 'admission-failed', field: 'workspace.path' },
            })
          }
        }
        const repairAlias = join(await realpath(root), 'repair-alias')
        await symlink(worktree, repairAlias, 'dir')
        const refreshed = readApplicationState(test.application.current())
        for (const key of [LOCAL, SOURCE_A]) {
          expect(
            await test.application.execute(
              commandSchema.parse({
                type: 'repair-project-workspace',
                project: fixtureProjectRef(key),
                workspace: { path: repairAlias },
                expectedConfigurationVersion: 1,
              }),
            ),
          ).toMatchObject({
            ok: false,
            error: { code: 'admission-failed', field: 'workspace.path' },
          })
        }
        const afterRepair = readApplicationState(test.application.current())
        expect(afterRepair.configurationVersion).toBe(refreshed.configurationVersion)
        expect(afterRepair.configuration).toEqual(refreshed.configuration)
        expect(afterRepair.projects).toEqual(refreshed.projects)
        expect(afterRepair.connections).toEqual(refreshed.connections)
        expect(afterRepair.automation).toEqual(refreshed.automation)
        expect(afterRepair.projects).toEqual(refreshed.projects)
        expect(project(afterRepair, SOURCE_A).resource).toEqual(
          project(refreshed, SOURCE_A).resource,
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
        const before = readApplicationState(test.application.current())
        expect(publicProjectObservation(project(before, SOURCE_A))?.observedAt).toBeTypeOf('number')
        expect(project(before, SOURCE_A).resource.kind).toBe('current-readable')
        expect(ticketObservation(before, SOURCE_A)?.value.body).toBe('A baseline body')
        expect(
          project(before, SOURCE_A).actions.some((action) => action.kind === 'server-launch'),
        ).toBe(true)
        expect(project(before, LOCAL).resource.kind).toBe('never-observed')
        expect(test.localInputs).toEqual([])
        await symlink(worktree, alias, 'dir')
        for (const key of [SOURCE_A, LOCAL]) {
          for (const actionId of ['open-workspace', 'open-terminal', 'reveal-source']) {
            expect(
              await test.application.execute(
                commandSchema.parse({
                  type: 'launch-action',
                  project: fixtureProjectRef(key),
                  actionId,
                  expectedConfigurationVersion: 1,
                }),
              ),
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
        const after = readApplicationState(test.application.current())
        expect(after.configurationVersion).toBe(before.configurationVersion)
        expect(after.configuration).toEqual(before.configuration)
        expect(
          after.projects.map(({ ref, connectionId, source, management }) => ({
            ref,
            connectionId,
            source,
            management,
          })),
        ).toEqual(
          before.projects.map(({ ref, connectionId, source, management }) => ({
            ref,
            connectionId,
            source,
            management,
          })),
        )
        expect(after.connections).toEqual(before.connections)
        expect(after.automation).toEqual(before.automation)
        expect(after.authorizationOperations).toEqual(before.authorizationOperations)
        expect(after.projects.map((row) => row.ref)).toEqual(before.projects.map((row) => row.ref))
        expect(project(after, LOCAL).managementWarnings.length).toBeGreaterThan(0)
        expect(project(after, SOURCE_A).managementWarnings.length).toBeGreaterThan(0)
        for (const key of [LOCAL, SOURCE_A]) {
          expect(project(after, key).resource).toEqual(project(before, key).resource)
          expect(project(after, key).mapsMembership).toEqual(project(before, key).mapsMembership)
          expect(project(after, key).maps).toEqual(project(before, key).maps)
          expect(project(after, key).displayOrder).toEqual(project(before, key).displayOrder)
          expect(project(after, key).activeMap).toEqual(project(before, key).activeMap)
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
      const before = readApplicationState(application.current())
      expect(project(before, LOCAL).resource.kind).toBe('never-observed')
      expect(
        await application.execute(
          commandSchema.parse({
            type: 'repair-project-workspace',
            project: fixtureProjectRef(LOCAL),
            workspace: { path: candidate },
            expectedConfigurationVersion: 1,
          }),
        ),
      ).toMatchObject({ ok: false, error: { code: 'admission-failed', field: 'workspace.path' } })
      expect(writes).toEqual([])
      expect(readApplicationState(application.current()).configurationVersion).toBe(1)
      expect(readApplicationState(application.current()).projects).toEqual(before.projects)
      expect(readApplicationState(application.current()).projects[0]).toMatchObject({
        ref: fixtureResourceRef(LOCAL),
        source: { integration: 'local', path: original },
        management: { displayName: 'Case-sensitive Local' },
      })
      expect(readApplicationState(application.current()).capturedAt).toEqual(before.capturedAt)
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
      expectOnlyActiveA(readApplicationState(test.application.current()))
      expect(
        ticketObservation(readApplicationState(test.application.current()), SOURCE_A)?.value?.body,
      ).toBe('A baseline body')
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
      const current = readApplicationState(test.application.current())
      expectOnlyActiveA(current)
      expect(project(current, SOURCE_A)).toMatchObject({
        resource: { kind: 'current-readable', observation: { observedAt: 31_000 } },
        maps: [
          {
            ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
            resource: {
              kind: 'current-readable',
              observation: { value: { body: { destination: 'A changed while B is pending' } } },
            },
            tickets: [
              {
                ref: fixtureTicketRef({ project: SOURCE_A, mapId: '108', ticketId: '109' }),
                resource: {
                  kind: 'current-readable',
                  observation: { value: { body: 'A changed while B is pending', isClaimed: true } },
                },
              },
            ],
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
      expect(readApplicationState(test.application.current()).configurationVersion).toBe(2)
      expect(
        ticketObservation(readApplicationState(test.application.current()), SOURCE_A)?.value?.body,
      ).toBe('A changed while B is pending')
      expect(
        ticketObservation(readApplicationState(test.application.current()), SOURCE_B)?.value?.body,
      ).toBe('B candidate body')
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
      const refresh = test.application.execute(
        commandSchema.parse({
          type: 'refresh-project',
          project: fixtureProjectRef(SOURCE_A),
          expectedConfigurationVersion: 1,
        }),
      )
      await gate.started
      test.update('101', 'Newest serialized A update', true)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(gate.pending()).toBe(true)
      expect(test.maximumInFlight('101')).toBe(1)
      expect(
        ticketObservation(readApplicationState(test.application.current()), SOURCE_A)?.value?.body,
      ).toBe('A baseline body')
      expect(test.events).toEqual([])
      gate.release()
      expect(await refresh).toMatchObject({
        ok: true,
        result: { type: 'project-refreshed', project: fixtureProjectRef(SOURCE_A) },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(test.maximumInFlight('101')).toBe(1)
      expect(
        ticketObservation(readApplicationState(test.application.current()), SOURCE_A)?.value,
      ).toMatchObject({
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
      expect(
        ticketObservation(readApplicationState(test.application.current()), SOURCE_A)?.value?.body,
      ).toBe('A baseline body')
      test.emit({
        ...CONFIGURATION,
        configurationVersion: 2,
        connections: [...CONFIGURATION.connections, CONNECTION_B],
        projects: [{ ...PROJECT_B, ref: PROJECT_A.ref }],
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(readApplicationState(test.application.current()).configurationVersion).toBe(2)
      expect(original.retired).toBe(true)
      expect(project(readApplicationState(test.application.current()), SOURCE_A)).toMatchObject({
        connectionId: 'connection-b',
        source: { repositoryId: '202' },
        maps: [
          {
            tickets: [
              {
                ref: fixtureResourceRef({
                  map: { project: SOURCE_A, mapId: '108' },
                  ticketId: '109',
                }),
                resource: {
                  kind: 'current-readable',
                  observation: { value: { body: 'B candidate body' } },
                },
              },
            ],
          },
        ],
      })
      const committed = readApplicationState(test.application.current())
      const published = test.states.length
      const events = test.events.length
      // Replay the captured real callback, including its real stable-ID and Connection provenance.
      original.replay()
      expect(readApplicationState(test.application.current())).toBe(committed)
      expect(test.states).toHaveLength(published)
      expect(test.events).toHaveLength(events)
      expect(
        ticketObservation(readApplicationState(test.application.current()), SOURCE_A)?.value?.body,
      ).toBe('B candidate body')
    } finally {
      await test.stop()
    }
  })

  // Catches missing provider aliases being treated as deletion or silently promoting a readable sibling.
  it('keeps a missing GitHub alias retained while a sibling reads and same-key recovery advances provenance', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const test = fixture()
    test.addSibling('101')
    try {
      await test.application.start()
      expect(project(readApplicationState(test.application.current()), SOURCE_A)).toMatchObject({
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
        },
        displayOrder: {
          open: ['108', '110'].map((mapId) => fixtureResourceRef({ project: SOURCE_A, mapId })),
        },
      })
      test.missingAlias('101', true)
      vi.setSystemTime(2000)
      expect(
        (
          await test.application.execute(
            commandSchema.parse({
              type: 'refresh-project',
              project: fixtureProjectRef(SOURCE_A),
              expectedConfigurationVersion: 1,
            }),
          )
        ).ok,
      ).toBe(true)
      expect(project(readApplicationState(test.application.current()), SOURCE_A)).toMatchObject({
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: ['108', '110'].map((mapId) => fixtureResourceRef({ project: SOURCE_A, mapId })),
        },
        maps: [
          {
            ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
            resource: {
              kind: 'retained-unavailable',
              lastSuccessful: {
                observedAt: 1000,
                provenance: {
                  integration: 'github',
                  connectionId: 'connection-a',
                  repositoryId: '101',
                  stage: 'map-read',
                },
                value: {
                  source: { kind: 'issue', url: 'https://github.com/acme/source-a/issues/108' },
                  body: { raw: expect.stringContaining('A baseline body') },
                },
              },
              unavailable: {
                attemptedAt: 2000,
                failure: { kind: 'access-ambiguous', evidence: 'missing-alias' },
              },
            },
          },
          {
            ref: fixtureResourceRef({ project: SOURCE_A, mapId: '110' }),
            resource: {
              kind: 'current-readable',
              observation: {
                observedAt: 2000,
                value: { body: { raw: expect.stringContaining('Readable sibling body') } },
              },
            },
          },
        ],
      })
      test.missingAlias('101', false)
      test.update('101', 'Recovered alias body')
      vi.setSystemTime(3000)
      expect(
        (
          await test.application.execute(
            commandSchema.parse({
              type: 'refresh-project',
              project: fixtureProjectRef(SOURCE_A),
              expectedConfigurationVersion: 1,
            }),
          )
        ).ok,
      ).toBe(true)
      expect(project(readApplicationState(test.application.current()), SOURCE_A)).toMatchObject({
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
        },
        maps: [
          {
            ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
            resource: {
              kind: 'current-readable',
              observation: {
                observedAt: 3000,
                provenance: {
                  integration: 'github',
                  connectionId: 'connection-a',
                  repositoryId: '101',
                  stage: 'map-read',
                },
                value: { body: { raw: expect.stringContaining('Recovered alias body') } },
              },
            },
          },
          {
            ref: fixtureResourceRef({ project: SOURCE_A, mapId: '110' }),
            resource: { kind: 'current-readable' },
          },
        ],
      })
      expect(test.launches).toEqual([])
    } finally {
      await test.stop()
    }
  })
  // Catches earlier omission proof hiding a returning identity's actual failed provider read.
  it.each([true, false])(
    'reports a returning GitHub missing alias after proven absence with prior success %s',
    async (hadSuccess) => {
      vi.useFakeTimers()
      vi.setSystemTime(1000)
      const test = fixture()
      test.addSibling('101')
      test.missingAlias('101', !hadSuccess)
      const target = { project: SOURCE_A, mapId: '108', ticketId: '109' }
      try {
        await test.application.start()
        const baseline = publicMapResource(
          project(readApplicationState(test.application.current()), SOURCE_A),
          '108',
        )
        expect(baseline?.resource.kind).toBe(hadSuccess ? 'current-readable' : 'never-observed')
        test.listMap('101', false)
        vi.setSystemTime(2000)
        expect(
          (
            await test.application.execute(
              commandSchema.parse({
                type: 'refresh-project',
                project: fixtureProjectRef(SOURCE_A),
                expectedConfigurationVersion: 1,
              }),
            )
          ).ok,
        ).toBe(true)
        expect(
          publicMapResource(
            project(readApplicationState(test.application.current()), SOURCE_A),
            '108',
          )?.resource,
        ).toMatchObject({
          kind: 'proven-absent',
          absence: { observedAt: 2000, proof: { kind: 'complete-membership' } },
          trace: hadSuccess
            ? { kind: 'last-successful-trace', lastSuccessful: { observedAt: 1000 } }
            : { kind: 'no-known-trace' },
        })
        test.listMap('101', true)
        test.missingAlias('101', true)
        vi.setSystemTime(3000)
        expect(
          (
            await test.application.execute(
              commandSchema.parse({
                type: 'refresh-project',
                project: fixtureProjectRef(SOURCE_A),
                expectedConfigurationVersion: 1,
              }),
            )
          ).ok,
        ).toBe(true)
        const returning = project(readApplicationState(test.application.current()), SOURCE_A)
        expect(returning).toMatchObject({
          mapsMembership: {
            kind: 'current-complete',
            observation: {
              observedAt: 3000,
              value: {
                members: [
                  fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
                  fixtureResourceRef({ project: SOURCE_A, mapId: '110' }),
                ],
              },
            },
          },
          activeMap: { kind: 'uncertain' },
          displayOrder: {
            open: ['110'].map((mapId) => fixtureResourceRef({ project: SOURCE_A, mapId })),
          },
        })
        const failure = {
          scope: { kind: 'map', map: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }) },
          attemptedAt: 3000,
          provenance: {
            integration: 'github',
            connectionId: 'connection-a',
            repositoryId: '101',
            stage: 'map-read',
          },
          failure: { kind: 'access-ambiguous', evidence: 'missing-alias' },
          cause: 'GitHub source is inaccessible; absence is not proven.',
        }
        const returnedMap = publicMapResource(returning, '108')
        expect(returnedMap?.resource).toMatchObject(
          hadSuccess
            ? { kind: 'retained-unavailable', unavailable: failure }
            : { kind: 'never-observed', current: failure },
        )
        if (hadSuccess && baseline?.resource.kind === 'current-readable' && returnedMap) {
          expect(returnedMap.resource).toMatchObject({
            lastSuccessful: baseline.resource.observation,
          })
          expect(publicTicketResource(returnedMap, '109')?.resource).toMatchObject({
            kind: 'retained-unavailable',
            lastSuccessful: { observedAt: 1000, value: { body: 'A baseline body' } },
          })
        }
        expect(
          await test.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target: fixtureTicketRef(target),
              stage: 'classification',
            }),
          ),
        ).toMatchObject({ ok: false })
        expect(readApplicationState(test.application.current()).automation.evidence).toEqual([])
        expect(test.launches).toEqual([])
        test.missingAlias('101', false)
        test.update('101', 'Returned same-key provider prose')
        vi.setSystemTime(4000)
        expect(
          (
            await test.application.execute(
              commandSchema.parse({
                type: 'refresh-project',
                project: fixtureProjectRef(SOURCE_A),
                expectedConfigurationVersion: 1,
              }),
            )
          ).ok,
        ).toBe(true)
        expect(project(readApplicationState(test.application.current()), SOURCE_A)).toMatchObject({
          activeMap: {
            kind: 'known-current',
            ref: fixtureResourceRef({ project: SOURCE_A, mapId: '108' }),
          },
          displayOrder: {
            open: ['108', '110'].map((mapId) => fixtureResourceRef({ project: SOURCE_A, mapId })),
          },
        })
        expect(
          publicMapResource(
            project(readApplicationState(test.application.current()), SOURCE_A),
            '108',
          )?.resource,
        ).toMatchObject({
          kind: 'current-readable',
          observation: {
            observedAt: 4000,
            value: { body: { raw: expect.stringContaining('Returned same-key provider prose') } },
          },
        })
      } finally {
        await test.stop()
      }
    },
  )
})
