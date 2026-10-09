import { setImmediate } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitHubObservationInput } from '../observation/coordinator.ts'
import type {
  ObservationBatch,
  SourceContribution,
  SourceProjectKey,
} from '../observation/source.ts'
import {
  type GitHubConnection,
  type GitHubProjectIntent,
  refineGitHubSourceAccess,
} from '../projects/registry.ts'
import { isRecord } from '../type-guards.ts'
import { createGitHubClient, type GitHubClient, GitHubError } from './client.ts'
import { type RawMapIssue, readMapsResponse } from './map-query.ts'
import { createGitHubObserverPool, type GitHubObserverOptions } from './observer.ts'

interface FakeRepository {
  id: string
  nameWithOwner: string
  maps: Map<number, RawMapIssue | null>
  unavailable?: boolean
  failure?: GitHubError
  rateLimitRemaining?: number
  graphqlGate?: Promise<void>
}

function rawMap(number: number, title: string): RawMapIssue {
  return {
    number,
    title,
    url: `https://github.com/a/roadmap/issues/${number}`,
    state: 'OPEN',
    updatedAt: '2026-08-01T00:00:00Z',
    closedAt: null,
    body: '## Destination\n\nSomewhere.\n',
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
  }
}

function rawBlockedMap(
  nameWithOwner: string,
  blockerRepositoryId: string,
  blockerName: string,
  includeDatabaseId = true,
): RawMapIssue {
  const [owner, repo] = nameWithOwner.split('/')
  if (!owner || !repo) throw new Error('Blocked map fixture requires a repository name.')
  const response = readMapsResponse([{ owner, repo, nameWithOwner, number: 1 }], {
    m0: mapWithBlocker(nameWithOwner, blockerRepositoryId, blockerName, includeDatabaseId),
  })
  const fetched = response.maps[0]
  if (!fetched) throw new Error('Blocked map fixture must contain a valid provider map.')
  return fetched.issue
}

function connection(id: string): GitHubConnection {
  return {
    id,
    integration: 'github',
    name: id,
    builtIn: false,
    githubIdentity: { id: `user-${id}`, login: id },
  }
}

function sourceInput(
  connectionId: string,
  repository: Pick<FakeRepository, 'id' | 'nameWithOwner'>,
  access: GitHubClient,
  projectId = repository.nameWithOwner,
): GitHubObservationInput {
  const configuredConnection = connection(connectionId)
  const intent: GitHubProjectIntent = {
    ref: { integration: 'github', projectId },
    connectionId,
    locator: { repositoryId: repository.id, nameWithOwner: repository.nameWithOwner },
    workspace: { path: '/not-required-for-source-observation' },
  }
  const refined = refineGitHubSourceAccess({
    intent,
    connection: configuredConnection,
    evidence: {
      connectionId,
      accountId: configuredConnection.githubIdentity.id,
      repositoryId: repository.id,
      access,
    },
  })
  if (!refined.ok) throw new Error(refined.error.message)
  return { integration: 'github', ref: refined.value.ref, source: refined.value }
}

async function observeInputs(
  inputs: GitHubObservationInput[],
  options: GitHubObserverOptions = {},
) {
  const pool = createGitHubObserverPool(options)
  const current = new Map<string, SourceContribution>()
  const updates: ObservationBatch[] = []
  const published = vi.fn<(contribution: SourceContribution) => void>()
  const observers = inputs.map((input) => {
    const observer = pool.create(input)
    observer.subscribe((contribution) => {
      published(contribution)
      current.set(contribution.project.id, contribution)
      updates.push({ attempts: [...current.values()].flatMap((value) => value.attempts) })
    })
    return { input, observer }
  })
  await Promise.all(observers.map(({ observer }) => observer.observe()))
  pool.reconcileTopology(inputs)
  return {
    pool,
    observers,
    updates,
    published,
    async refresh(project: SourceProjectKey) {
      const selected = observers.find(({ input }) => input.ref.projectId === project.id)
      if (!selected) throw new Error('Project is not in the admitted source topology.')
      return selected.observer.refresh()
    },
    stop: () => pool.stop(),
  }
}

function fakeClient(repositories: FakeRepository[], remaining = 200) {
  const restPaths: string[] = []
  const graphqlCalls: Record<string, unknown>[] = []
  const client: GitHubClient = {
    async graphql(_query, variables = {}) {
      graphqlCalls.push(variables)
      const firstRepository = repositories.find(
        (candidate) => candidate.nameWithOwner === `${variables.o0}/${variables.n0}`,
      )
      await firstRepository?.graphqlGate
      const data: Record<string, unknown> = {
        rateLimit: {
          cost: 1,
          remaining: firstRepository?.rateLimitRemaining ?? remaining,
          limit: 5000,
          resetAt: '2026-08-22T12:00:00Z',
        },
      }
      for (let index = 0; `o${index}` in variables; index += 1) {
        const nameWithOwner = `${variables[`o${index}`]}/${variables[`n${index}`]}`
        const repository = repositories.find(
          (candidate) => candidate.nameWithOwner === nameWithOwner,
        )
        const issue = repository?.maps.get(Number(variables[`i${index}`]))
        data[`m${index}`] = repository
          ? {
              databaseId: repository.id,
              nameWithOwner,
              issue: issue
                ? { ...issue, url: `https://github.com/${nameWithOwner}/issues/${issue.number}` }
                : null,
            }
          : null
      }
      return { data, errors: [] }
    },
    async restGet(path) {
      restPaths.push(path)
      const byId = /^\/repositories\/([^/?]+)$/.exec(path)
      if (byId) {
        const repository = repositories.find((candidate) => candidate.id === byId[1])
        if (repository?.failure) throw repository.failure
        if (!repository || repository.unavailable)
          throw new GitHubError({ kind: 'access-ambiguous', evidence: 'http-404' }, 404)
        return { id: Number(repository.id), full_name: repository.nameWithOwner }
      }
      const issues = /^\/repos\/([^/]+)\/([^/]+)\/issues\?/.exec(path)
      if (issues) {
        const nameWithOwner = `${decodeURIComponent(issues[1] ?? '')}/${decodeURIComponent(issues[2] ?? '')}`
        const repository = repositories.find(
          (candidate) => candidate.nameWithOwner === nameWithOwner,
        )
        if (!repository)
          throw new GitHubError({ kind: 'access-ambiguous', evidence: 'http-404' }, 404)
        return [...repository.maps.keys()].map((number) => ({ number }))
      }
      throw new Error(`Unexpected REST path ${path}`)
    },
  }
  return { client, restPaths, graphqlCalls }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createGitHubObserverPool', () => {
  it.each(['baseline', 'refresh'] as const)(
    'joins a pending %s read for repeated owner and pool stop without late publication',
    async (phase) => {
      const repository: FakeRepository = {
        id: '1',
        nameWithOwner: 'acme/lifetime',
        maps: new Map([[1, rawMap(1, 'Pending source read')]]),
      }
      const access = fakeClient([repository])
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let gated = phase === 'baseline'
      const client: GitHubClient = {
        restGet: access.client.restGet,
        async graphql(query, variables) {
          if (gated) {
            entered.resolve()
            await release.promise
          }
          return access.client.graphql(query, variables)
        },
      }
      const pool = createGitHubObserverPool()
      const input = sourceInput('lifetime', repository, client)
      const observer = pool.create(input)
      const publications: SourceContribution[] = []
      observer.subscribe((value) => publications.push(value))
      let read: Promise<unknown> = Promise.resolve()
      const stops: Promise<void>[] = []
      try {
        if (phase === 'refresh') {
          await observer.observe()
          pool.reconcileTopology([input])
          gated = true
        }
        read = (phase === 'baseline' ? observer.observe() : observer.refresh()).then(
          () => 'resolved',
          () => 'rejected',
        )
        await entered.promise
        const beforeStop = publications.length
        const settled: number[] = []
        stops.push(observer.stop(), observer.stop(), pool.stop(), pool.stop())
        stops.forEach((stop, index) => void stop.then(() => settled.push(index)))
        await setImmediate()
        expect(settled).toEqual([])
        release.resolve()
        await Promise.all([...stops, read])
        expect(publications).toHaveLength(beforeStop)
        await expect(observer.refresh()).rejects.toThrow('stopped')
      } finally {
        release.resolve()
        await read
        await Promise.all([...stops, pool.stop()])
      }
    },
  )

  it('publishes distinct actual reads when source time and payload stay identical', async () => {
    const repository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Unchanged map')]]),
    }
    const access = fakeClient([repository], 4_000)
    const pool = createGitHubObserverPool({ now: () => 1_000 })
    const input = sourceInput('one', repository, access.client)
    const observer = pool.create(input)
    const updates: SourceContribution[] = []
    observer.subscribe((contribution) => updates.push(contribution))
    try {
      const baseline = await observer.observe()
      pool.reconcileTopology([input])
      const publicationCount = updates.length
      const refreshed = await observer.refresh()
      expect(updates).toHaveLength(publicationCount + 1)
      expect(refreshed.attempts.map(({ readSequence, ...attempt }) => attempt)).toEqual(
        baseline.attempts.map(({ readSequence, ...attempt }) => attempt),
      )
      for (let index = 0; index < baseline.attempts.length; index += 1) {
        const previous = baseline.attempts[index]
        const current = refreshed.attempts[index]
        expect(previous).toBeDefined()
        expect(current?.readSequence).toBeGreaterThan(previous?.readSequence ?? 0)
      }
      expect(baseline.attempts.map((attempt) => attempt.readSequence)).toEqual([1, 2, 3, 3])
      expect(refreshed.attempts.map((attempt) => attempt.readSequence)).toEqual([4, 5, 6, 6])
    } finally {
      await pool.stop()
    }
  })

  it('preserves cached ticket read identity while reclassifying topology under a newer root failure', async () => {
    const parent: FakeRepository = {
      id: '1',
      nameWithOwner: 'acme/parent',
      maps: new Map([[1, rawBlockedMap('acme/parent', '2', 'acme/dependency')]]),
    }
    const dependency = {
      id: '2',
      nameWithOwner: 'acme/dependency',
      maps: new Map<number, RawMapIssue>(),
    }
    const access = fakeClient([parent, dependency], 4_000)
    const pool = createGitHubObserverPool({ now: () => 1_000, logger: { warn() {} } })
    const parentInput = sourceInput('one', parent, access.client, 'parent-key')
    const dependencyInput = sourceInput('two', dependency, access.client, 'dependency-key')
    const observer = pool.create(parentInput)
    const dependencyObserver = pool.create(dependencyInput)
    const updates: SourceContribution[] = []
    observer.subscribe((contribution) => updates.push(contribution))
    try {
      const baseline = await observer.observe()
      pool.reconcileTopology([parentInput])
      const initialTicket = baseline.attempts.find((attempt) => attempt.scope.kind === 'ticket')
      expect(initialTicket).toMatchObject({ readSequence: 3, observedAt: 1_000 })
      parent.failure = new GitHubError({ kind: 'transient', cause: 'server' })
      const failed = await observer.refresh()
      expect(failed.attempts.find((attempt) => attempt.scope.kind === 'project')).toMatchObject({
        kind: 'failed',
        readSequence: 4,
      })
      await dependencyObserver.observe()
      const mapReads = access.graphqlCalls.length
      pool.reconcileTopology([parentInput, dependencyInput])
      const reinterpreted = updates
        .at(-1)
        ?.attempts.find((attempt) => attempt.scope.kind === 'ticket')
      expect(reinterpreted).toMatchObject({
        kind: 'observed',
        readSequence: 3,
        observedAt: 1_000,
        value: {
          blockedBy: [
            expect.objectContaining({
              reference: {
                kind: 'registered',
                project: { integration: 'github', id: 'dependency-key' },
                ticketId: '20',
              },
            }),
          ],
        },
      })
      expect(
        updates.at(-1)?.attempts.find((attempt) => attempt.scope.kind === 'project'),
      ).toMatchObject({
        kind: 'failed',
        readSequence: 4,
      })
      expect(access.graphqlCalls).toHaveLength(mapReads)
    } finally {
      await pool.stop()
    }
  })

  it('observes admitted stable scopes across isolated Connection access including complete empty membership', async () => {
    const first = {
      id: '1',
      nameWithOwner: 'acme/renamed',
      maps: new Map([[16, rawMap(16, 'Current map')]]),
    }
    const empty = { id: '2', nameWithOwner: 'acme/empty', maps: new Map<number, RawMapIssue>() }
    const second = {
      id: '3',
      nameWithOwner: 'other/roadmap',
      maps: new Map([[7, rawMap(7, 'Other map')]]),
    }
    const firstAccess = fakeClient([first, empty]).client
    const secondAccess = fakeClient([second]).client
    const sources = await observeInputs([
      sourceInput('one', first, firstAccess, 'acme/original'),
      sourceInput('one', empty, firstAccess),
      sourceInput('two', second, secondAccess),
    ])
    try {
      expect(sources.updates.at(-1)?.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'project', project: { integration: 'github', id: 'acme/original' } },
            value: expect.objectContaining({
              name: 'acme/renamed',
              source: expect.objectContaining({
                repositoryId: '1',
                url: 'https://github.com/acme/renamed',
              }),
            }),
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'map',
              map: { project: { integration: 'github', id: 'acme/original' }, mapId: '16' },
            },
            value: expect.objectContaining({ title: 'Current map' }),
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'maps-membership',
              project: { integration: 'github', id: 'acme/empty' },
            },
            completeness: { kind: 'complete' },
            value: { members: [] },
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'project', project: { integration: 'github', id: 'other/roadmap' } },
          }),
        ]),
      )
      for (const [contribution] of sources.published.mock.calls) {
        expect(contribution.health).toEqual({ status: 'available', observedAt: expect.any(Number) })
        expect(contribution.attempts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: { kind: 'project', project: contribution.project },
            }),
          ]),
        )
      }
    } finally {
      await sources.stop()
    }
  })

  it('contains rejected credentials to one Connection and publishes health with failed attempts without credential details', async () => {
    const broken = { id: '1', nameWithOwner: 'acme/private', maps: new Map<number, RawMapIssue>() }
    const healthy = {
      id: '2',
      nameWithOwner: 'other/roadmap',
      maps: new Map<number, RawMapIssue>(),
    }
    const rejected: GitHubClient = {
      restGet: async () => {
        throw new GitHubError({ kind: 'authorization', proof: 'rejected-credential' })
      },
      graphql: async () => {
        throw new Error('private credential detail')
      },
    }
    const warn = vi.fn()
    const sources = await observeInputs(
      [
        sourceInput('broken', broken, rejected),
        sourceInput('healthy', healthy, fakeClient([healthy]).client),
      ],
      { logger: { warn } },
    )
    try {
      expect(sources.published).toHaveBeenCalledWith(
        expect.objectContaining({
          project: { integration: 'github', id: 'acme/private' },
          health: expect.objectContaining({ status: 'authorization-required' }),
          attempts: expect.arrayContaining([
            expect.objectContaining({
              kind: 'failed',
              scope: { kind: 'project', project: { integration: 'github', id: 'acme/private' } },
              provenance: expect.objectContaining({ stage: 'credentials' }),
              failure: { kind: 'authorization', proof: 'rejected-credential' },
            }),
          ]),
        }),
      )
      expect(sources.updates.at(-1)?.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'project', project: { integration: 'github', id: 'other/roadmap' } },
          }),
        ]),
      )
      expect(JSON.stringify(sources.published.mock.calls)).not.toContain(
        'private credential detail',
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private credential detail')
    } finally {
      await sources.stop()
    }
  })

  it('degrades after repeated transient failures while independently successful scopes commit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const first = {
      id: '1',
      nameWithOwner: 'acme/first',
      maps: new Map([[1, rawMap(1, 'First map')]]),
    }
    const second: FakeRepository = {
      id: '2',
      nameWithOwner: 'acme/second',
      maps: new Map([[2, rawMap(2, 'Second map')]]),
    }
    const access = fakeClient([first, second], 4_000).client
    const sources = await observeInputs(
      [sourceInput('one', first, access), sourceInput('one', second, access)],
      { logger: { warn() {} }, reconcileMs: 10 },
    )
    try {
      second.failure = new GitHubError({ kind: 'transient', cause: 'server' }, 503)
      first.maps.set(1, rawMap(1, 'Changed sibling'))
      await vi.advanceTimersByTimeAsync(10)
      expect(
        sources.published.mock.calls
          .filter(([value]) => value.project.id === 'acme/second')
          .at(-1)?.[0],
      ).toMatchObject({ health: { status: 'available', observedAt: 1_000 } })
      expect(sources.updates.at(-1)?.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'map',
              map: { project: { integration: 'github', id: 'acme/first' }, mapId: '1' },
            },
            observedAt: 1_010,
            value: expect.objectContaining({ title: 'Changed sibling' }),
          }),
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project: { integration: 'github', id: 'acme/second' } },
            attemptedAt: 1_010,
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'map',
              map: { project: { integration: 'github', id: 'acme/second' }, mapId: '2' },
            },
            observedAt: 1_000,
          }),
        ]),
      )
      await vi.advanceTimersByTimeAsync(10)
      expect(
        sources.published.mock.calls
          .filter(([value]) => value.project.id === 'acme/second')
          .at(-1)?.[0],
      ).toMatchObject({ health: { status: 'degraded', observedAt: 1_000 } })
      second.failure = undefined
      await vi.advanceTimersByTimeAsync(20)
      expect(
        sources.published.mock.calls
          .filter(([value]) => value.project.id === 'acme/second')
          .at(-1)?.[0],
      ).toMatchObject({ health: { status: 'available', observedAt: 1_040 } })
    } finally {
      await sources.stop()
    }
  })

  it('paces each Connection using its own rate budget', async () => {
    vi.useFakeTimers()
    const slowRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Map')]]),
    }
    const fastRepository = {
      id: '2',
      nameWithOwner: 'other/roadmap',
      maps: new Map([[2, rawMap(2, 'Map')]]),
    }
    const slow = fakeClient([slowRepository], 200)
    const fast = fakeClient([fastRepository], 4000)
    const sources = await observeInputs(
      [
        sourceInput('slow', slowRepository, slow.client),
        sourceInput('fast', fastRepository, fast.client),
      ],
      { reconcileMs: 10 },
    )
    try {
      await vi.advanceTimersByTimeAsync(10)
      expect(sources.updates.at(-1)?.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'map',
              map: { project: { integration: 'github', id: 'acme/roadmap' }, mapId: '1' },
            },
            observedAt: expect.any(Number),
          }),
        ]),
      )
      expect(slow.graphqlCalls).toHaveLength(1)
      expect(fast.graphqlCalls).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(70)
      expect(slow.graphqlCalls).toHaveLength(2)
    } finally {
      await sources.stop()
    }
  })

  it('paces polling by the lower concurrent budget after an older response arrives late', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    let open: () => void = () => {
      throw new Error('Gate not initialized.')
    }
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const older: FakeRepository = {
      id: '1',
      nameWithOwner: 'acme/older',
      maps: new Map([[1, rawMap(1, 'Older response')]]),
      rateLimitRemaining: 4_000,
      graphqlGate: gate,
    }
    const newer: FakeRepository = {
      id: '2',
      nameWithOwner: 'acme/newer',
      maps: new Map([[2, rawMap(2, 'Newer response')]]),
      rateLimitRemaining: 100,
    }
    const access = fakeClient([older, newer])
    const requestTimes: number[] = []
    const client: GitHubClient = {
      ...access.client,
      graphql(query, variables) {
        requestTimes.push(Date.now())
        return access.client.graphql(query, variables)
      },
    }
    const pool = createGitHubObserverPool({ reconcileMs: 10 })
    const olderInput = sourceInput('one', older, client)
    const newerInput = sourceInput('one', newer, client)
    const olderObserver = pool.create(olderInput)
    const newerObserver = pool.create(newerInput)
    const baseline = Promise.all([olderObserver.observe(), newerObserver.observe()])
    try {
      await newerObserver.observe()
      expect(requestTimes).toEqual([1_000, 1_000])
      open()
      await baseline
      pool.reconcileTopology([olderInput, newerInput])
      await vi.advanceTimersByTimeAsync(79)
      expect(requestTimes).toEqual([1_000, 1_000])
      await vi.advanceTimersByTimeAsync(1)
      expect(requestTimes).toEqual([1_000, 1_000, 1_080, 1_080])
    } finally {
      open()
      await baseline
      await pool.stop()
    }
  })

  it('owns an idempotent baseline and stops only the retired scope on a shared Connection', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const retired = {
      id: '1',
      nameWithOwner: 'acme/retired',
      maps: new Map([[1, rawMap(1, 'Retired map')]]),
    }
    const retained = {
      id: '2',
      nameWithOwner: 'acme/retained',
      maps: new Map([[2, rawMap(2, 'Retained map')]]),
    }
    const { client, graphqlCalls } = fakeClient([retired, retained], 4_000)
    const pool = createGitHubObserverPool({ reconcileMs: 10 })
    const retiredInput = sourceInput('one', retired, client)
    const retainedInput = sourceInput('one', retained, client)
    const retiredObserver = pool.create(retiredInput)
    const retainedObserver = pool.create(retainedInput)
    const retiredUpdates = vi.fn<(contribution: SourceContribution) => void>()
    const retainedUpdates = vi.fn<(contribution: SourceContribution) => void>()
    retiredObserver.subscribe(retiredUpdates)
    const unsubscribe = retainedObserver.subscribe(retainedUpdates)
    try {
      const baseline = retiredObserver.observe()
      expect(retiredObserver.observe()).toBe(baseline)
      await Promise.all([baseline, retainedObserver.observe()])
      pool.reconcileTopology([retiredInput, retainedInput])
      expect(graphqlCalls).toHaveLength(2)
      const retiredCount = retiredUpdates.mock.calls.length
      await retiredObserver.stop()
      pool.reconcileTopology([retainedInput])
      retained.maps.set(2, rawMap(2, 'Still supervised'))
      await vi.advanceTimersByTimeAsync(10)
      expect(retiredUpdates).toHaveBeenCalledTimes(retiredCount)
      expect(retainedUpdates).toHaveBeenLastCalledWith(
        expect.objectContaining({
          project: { integration: 'github', id: 'acme/retained' },
          health: { status: 'available', observedAt: 1_010 },
          attempts: expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              value: expect.objectContaining({ title: 'Still supervised' }),
            }),
          ]),
        }),
      )
      await expect(retiredObserver.refresh()).rejects.toThrow('stopped')
      const retainedCount = retainedUpdates.mock.calls.length
      unsubscribe()
      vi.setSystemTime(2_000)
      const refreshed = await retainedObserver.refresh()
      expect(refreshed.health).toEqual({ status: 'available', observedAt: 2_000 })
      expect(retainedUpdates).toHaveBeenCalledTimes(retainedCount)
    } finally {
      await pool.stop()
    }
  })

  it.each(['one', 'two'])(
    'polls an active owner while a candidate on Connection %s awaits its identity baseline',
    async (candidateConnection) => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)
      const active = {
        id: '1',
        nameWithOwner: 'acme/active',
        maps: new Map([[1, rawMap(1, 'Baseline')]]),
      }
      const candidate = {
        id: '2',
        nameWithOwner: 'acme/candidate',
        maps: new Map<number, RawMapIssue>(),
      }
      const access = fakeClient([active, candidate], 4_000).client
      const started = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      const candidateAccess: GitHubClient = {
        graphql: access.graphql,
        async restGet(path) {
          if (path === '/repositories/2') {
            started.resolve()
            await gate.promise
          }
          return access.restGet(path)
        },
      }
      const pool = createGitHubObserverPool({ reconcileMs: 10 })
      const activeInput = sourceInput('one', active, access, 'active-key')
      const candidateInput = sourceInput(
        candidateConnection,
        candidate,
        candidateAccess,
        'candidate-key',
      )
      const activeObserver = pool.create(activeInput)
      const candidateObserver = pool.create(candidateInput)
      const updates: SourceContribution[] = []
      activeObserver.subscribe((value) => updates.push(value))
      let baseline: Promise<SourceContribution> | null = null
      try {
        await activeObserver.observe()
        pool.reconcileTopology([activeInput])
        baseline = candidateObserver.observe()
        await started.promise
        active.maps.set(1, {
          ...rawBlockedMap('acme/active', '2', 'acme/candidate'),
          title: 'Polled while candidate waits',
        })
        await vi.advanceTimersByTimeAsync(10)
        expect(updates.at(-1)).toMatchObject({
          health: { status: 'available', observedAt: 1_010 },
          attempts: expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: {
                kind: 'map',
                map: { project: { integration: 'github', id: 'active-key' }, mapId: '1' },
              },
              value: expect.objectContaining({ title: 'Polled while candidate waits' }),
            }),
            expect.objectContaining({
              kind: 'observed',
              scope: expect.objectContaining({ kind: 'ticket' }),
              observedAt: 1_010,
              value: expect.objectContaining({
                blockedBy: [
                  expect.objectContaining({
                    reference: {
                      kind: 'external',
                      integration: 'github',
                      repositoryId: '2',
                      nameWithOwner: 'acme/candidate',
                      ticketId: '20',
                    },
                  }),
                ],
              }),
            }),
          ]),
        })
        const published = updates.length
        gate.resolve()
        await baseline
        expect(updates).toHaveLength(published)
        vi.setSystemTime(2_000)
        pool.reconcileTopology([activeInput, candidateInput])
        expect(updates.at(-1)).toMatchObject({
          health: { status: 'available', observedAt: 1_010 },
          attempts: expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: expect.objectContaining({ kind: 'ticket' }),
              observedAt: 1_010,
              value: expect.objectContaining({
                blockedBy: [
                  expect.objectContaining({
                    reference: {
                      kind: 'registered',
                      project: { integration: 'github', id: 'candidate-key' },
                      ticketId: '20',
                    },
                  }),
                ],
              }),
            }),
          ]),
        })
      } finally {
        gate.resolve()
        await baseline
        await pool.stop()
      }
    },
  )

  it('reclassifies cached blockers after another Connection discovers a rename without rereading or advancing source time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const parent = {
      id: '1',
      nameWithOwner: 'acme/parent',
      maps: new Map([[1, rawBlockedMap('acme/parent', '2', 'acme/renamed', false)]]),
    }
    const dependency = {
      id: '2',
      nameWithOwner: 'acme/original',
      maps: new Map<number, RawMapIssue>(),
    }
    const parentAccess = fakeClient([parent], 4_000)
    const dependencyAccess = fakeClient([dependency], 4_000)
    const sources = await observeInputs([
      sourceInput('one', parent, parentAccess.client, 'parent-key'),
      sourceInput('two', dependency, dependencyAccess.client, 'dependency-key'),
    ])
    try {
      expect(
        sources.published.mock.calls
          .filter(([value]) => value.project.id === 'parent-key')
          .at(-1)?.[0],
      ).toMatchObject({
        attempts: expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: expect.objectContaining({ kind: 'ticket' }),
            value: expect.objectContaining({
              blockedBy: [
                expect.objectContaining({
                  reference: expect.objectContaining({ kind: 'external' }),
                }),
              ],
            }),
          }),
        ]),
      })
      const parentReads = parentAccess.restPaths.length
      dependency.nameWithOwner = 'acme/renamed'
      vi.setSystemTime(2_000)
      await sources.refresh({ integration: 'github', id: 'dependency-key' })
      expect(parentAccess.restPaths).toHaveLength(parentReads)
      expect(
        sources.published.mock.calls
          .filter(([value]) => value.project.id === 'parent-key')
          .at(-1)?.[0],
      ).toMatchObject({
        health: { status: 'available', observedAt: 1_000 },
        attempts: expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: expect.objectContaining({ kind: 'ticket' }),
            observedAt: 1_000,
            value: expect.objectContaining({
              blockedBy: [
                expect.objectContaining({
                  reference: {
                    kind: 'registered',
                    project: { integration: 'github', id: 'dependency-key' },
                    ticketId: '20',
                  },
                }),
              ],
            }),
          }),
        ]),
      })
    } finally {
      await sources.stop()
    }
  })

  it('joins a retired owner read when the pool stops and publishes no retired callback', async () => {
    const repository = {
      id: '1',
      nameWithOwner: 'acme/retired',
      maps: new Map([[1, rawMap(1, 'Retired')]]),
    }
    const access = fakeClient([repository], 4_000).client
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    let readFinished = false
    const pool = createGitHubObserverPool()
    const observer = pool.create(
      sourceInput('one', repository, {
        restGet: access.restGet,
        async graphql(query, variables) {
          started.resolve()
          await gate.promise
          const result = await access.graphql(query, variables)
          readFinished = true
          return result
        },
      }),
    )
    const updates: SourceContribution[] = []
    observer.subscribe((value) => updates.push(value))
    const baseline = observer.observe().catch(() => null)
    await started.promise
    const retirement = observer.stop()
    let poolStopped = false
    const stopping = pool.stop().then(() => {
      poolStopped = true
    })
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(poolStopped).toBe(false)
      expect(readFinished).toBe(false)
      gate.resolve()
      await Promise.all([baseline, retirement, stopping])
      expect(readFinished).toBe(true)
      expect(updates).toEqual([])
      await expect(observer.refresh()).rejects.toThrow('stopped')
    } finally {
      gate.resolve()
      await Promise.all([baseline, retirement, stopping])
    }
  })
})

interface HttpRepository {
  id: string
  metadataId?: string
  nameWithOwner: string
  maps: Map<number, RawMapIssue>
  metadataStatus?: number
  metadata?: unknown
  listing?: unknown
  secondPage?: unknown
  secondPageStatus?: number
  aliases?: Map<number, unknown>
  graphqlResponse?: () => Response
  laterBatchStatus?: number
}

function providerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function stubProvider(repositories: readonly HttpRepository[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const byId = /^\/repositories\/([^/]+)$/.exec(url.pathname)
      if (byId) {
        const repository = repositories.find((candidate) => candidate.id === byId[1])
        if (!repository) return providerResponse({ message: 'Not Found' }, 404)
        if (repository.metadataStatus) {
          return providerResponse(
            { message: 'private provider detail fixture-token' },
            repository.metadataStatus,
          )
        }
        if (repository.metadata !== undefined) return providerResponse(repository.metadata)
        return providerResponse({
          id: Number(repository.metadataId ?? repository.id),
          full_name: repository.nameWithOwner,
        })
      }
      const list = /^\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(url.pathname)
      if (list) {
        const repository = repositories.find(
          (candidate) => candidate.nameWithOwner === `${list[1]}/${list[2]}`,
        )
        if (!repository) return providerResponse({ message: 'Not Found' }, 404)
        const page = Number(url.searchParams.get('page') ?? 1)
        if (page > 1 && repository.secondPage !== undefined)
          return providerResponse(repository.secondPage, repository.secondPageStatus)
        if (repository.listing !== undefined) return providerResponse(repository.listing)
        const issues = [...repository.maps.keys()].map((number) => ({ number }))
        return providerResponse(issues.slice((page - 1) * 100, page * 100))
      }
      if (url.pathname === '/graphql') {
        const body: unknown = JSON.parse(String(init?.body))
        if (!isRecord(body) || !isRecord(body.variables)) throw new Error('Invalid fixture query.')
        const variables = body.variables
        const first = repositories.find(
          (candidate) => candidate.nameWithOwner === `${variables.o0}/${variables.n0}`,
        )
        if (first?.graphqlResponse) return first.graphqlResponse()
        if (first?.laterBatchStatus && Number(variables.i0) > 10) {
          return providerResponse({ message: 'private later batch detail' }, first.laterBatchStatus)
        }
        const data: Record<string, unknown> = {
          rateLimit: { cost: 1, remaining: 4_000, limit: 5_000, resetAt: '2026-10-08T16:00:00Z' },
        }
        for (let index = 0; `o${index}` in variables; index += 1) {
          const repository = repositories.find(
            (candidate) =>
              candidate.nameWithOwner === `${variables[`o${index}`]}/${variables[`n${index}`]}`,
          )
          const number = Number(variables[`i${index}`])
          if (repository?.aliases?.has(number)) {
            const alias = repository.aliases.get(number)
            if (alias !== undefined) data[`m${index}`] = alias
          } else {
            data[`m${index}`] = repository
              ? {
                  id: `R_${repository.id}`,
                  databaseId: Number(repository.id),
                  nameWithOwner: repository.nameWithOwner,
                  issue: repository.maps.has(number)
                    ? {
                        ...repository.maps.get(number),
                        url: `https://github.com/${repository.nameWithOwner}/issues/${number}`,
                      }
                    : null,
                }
              : null
          }
        }
        return providerResponse({ data })
      }
      throw new Error(`Unexpected fixture URL ${url.href}`)
    }),
  )
}

async function observedSources(
  repositories: HttpRepository[],
  admitted?: GitHubObservationInput[],
) {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  stubProvider(repositories)
  const warn = vi.fn()
  const access = createGitHubClient({ token: 'fixture-token' })
  const inputs =
    admitted ?? repositories.map((repository) => sourceInput('one', repository, access))
  const sources = await observeInputs(inputs, { logger: { warn }, reconcileMs: 10 })
  return { sources, updates: sources.updates, published: sources.published, warn }
}

describe('GitHub scoped source evidence through the real client', () => {
  const project = { integration: 'github', id: 'acme/roadmap' } satisfies SourceProjectKey
  const mapScope = { kind: 'map', map: { project, mapId: '1' } }

  it.each([{}, { permissions: { pull: true } }])(
    'does not turn permission-only metadata %j into a successful admitted source read',
    async (metadata) => {
      const repository: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/roadmap',
        maps: new Map([[1, rawMap(1, 'Unread map')]]),
        metadata,
      }
      const { sources, updates, published } = await observedSources([repository])
      try {
        expect(updates.at(-1)?.attempts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'failed',
              scope: { kind: 'project', project },
              failure: { kind: 'read', cause: 'malformed-response' },
            }),
          ]),
        )
        expect(updates.at(-1)?.attempts.some((attempt) => attempt.kind === 'observed')).toBe(false)
        expect(published.mock.calls.at(-1)?.[0].health).toMatchObject({ status: 'unavailable' })
      } finally {
        await sources.stop()
      }
    },
  )

  it('rejects a mismatched stable metadata identity before reading maps under the admitted key', async () => {
    const repository: HttpRepository = {
      id: '1',
      metadataId: '999',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Wrong identity')]]),
    }
    const { sources, updates } = await observedSources([repository])
    try {
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project },
            failure: { kind: 'identity-mismatch' },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'observed', scope: mapScope })]),
      )
    } finally {
      await sources.stop()
    }
  })

  it('recovers the admitted opaque key after access ambiguity and a repository rename without requiring Workspace proof', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const admitted = sourceInput(
      'one',
      repository,
      createGitHubClient({ token: 'fixture-token' }),
      'opaque stable/%2F',
    )
    const key = { integration: 'github', id: admitted.ref.projectId } satisfies SourceProjectKey
    const { sources, updates } = await observedSources([repository], [admitted])
    try {
      repository.metadataStatus = 404
      vi.setSystemTime(2_000)
      await sources.refresh(key)
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project: key },
            failure: { kind: 'access-ambiguous', evidence: 'http-404' },
          }),
        ]),
      )
      repository.metadataStatus = undefined
      repository.nameWithOwner = 'acme/renamed'
      vi.setSystemTime(3_000)
      await sources.refresh(key)
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'project', project: key },
            observedAt: 3_000,
            value: expect.objectContaining({ name: 'acme/renamed' }),
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'map', map: { project: key, mapId: '1' } },
            observedAt: 3_000,
          }),
        ]),
      )
      expect(admitted.source).toMatchObject({
        repositoryId: '1',
        locator: { nameWithOwner: 'acme/roadmap' },
      })
      expect(admitted).not.toHaveProperty('workspace')
    } finally {
      await sources.stop()
    }
  })

  it.each([
    [
      'HTTP-200 execution errors',
      () => providerResponse({ errors: [{ message: 'private provider detail fixture-token' }] }),
      { kind: 'execution', cause: 'provider' },
    ],
    [
      'malformed payload',
      () =>
        providerResponse({
          data: { m0: { databaseId: 1, nameWithOwner: 'acme/roadmap', issue: { number: 1 } } },
        }),
      { kind: 'read', cause: 'malformed-response' },
    ],
    [
      'invalid JSON',
      () => new Response('private provider detail fixture-token {'),
      { kind: 'read', cause: 'malformed-response' },
    ],
    [
      'body-read rejection',
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('private provider detail fixture-token'))
            },
          }),
        ),
      { kind: 'read', cause: 'response-read' },
    ],
  ])(
    'publishes a failed map scope after %s without inventing successful time',
    async (_name, failureResponse, failure) => {
      const repository: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/roadmap',
        maps: new Map([[1, rawMap(1, 'Known map')]]),
      }
      const { sources, updates, warn } = await observedSources([repository])
      try {
        expect(updates[0]).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: mapScope,
              observedAt: 1_000,
              value: expect.objectContaining({ title: 'Known map' }),
            }),
          ]),
        )
        repository.graphqlResponse = failureResponse
        vi.setSystemTime(2_000)
        await sources.refresh(project)

        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'failed',
              scope: mapScope,
              attemptedAt: 2_000,
              failure,
            }),
          ]),
        )
        expect(updates.at(-1)).not.toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({ kind: 'observed', scope: mapScope, observedAt: 2_000 }),
          ]),
        )
        expect(JSON.stringify(updates)).not.toContain('private provider detail')
        expect(JSON.stringify(warn.mock.calls)).not.toContain('fixture-token')

        repository.graphqlResponse = undefined
        repository.maps.set(1, rawMap(1, 'Recovered map'))
        vi.setSystemTime(3_000)
        await sources.refresh(project)

        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: mapScope,
              observedAt: 3_000,
              value: expect.objectContaining({ title: 'Recovered map' }),
            }),
          ]),
        )
      } finally {
        await sources.stop()
      }
    },
  )

  it('commits a healthy Project scope beside repeated transient failure in another Project', async () => {
    const healthy: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/healthy',
      maps: new Map([[1, rawMap(1, 'Old healthy map')]]),
    }
    const failing: HttpRepository = {
      id: '2',
      nameWithOwner: 'acme/failing',
      maps: new Map([[2, rawMap(2, 'Known failing map')]]),
    }
    const { sources, updates, published } = await observedSources([healthy, failing])
    try {
      failing.metadataStatus = 503
      healthy.maps.set(1, rawMap(1, 'New healthy map'))
      vi.setSystemTime(2_000)
      await sources.refresh({ integration: 'github', id: 'acme/healthy' })
      vi.setSystemTime(3_000)
      await sources.refresh({ integration: 'github', id: 'acme/healthy' })

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'map',
              map: { project: { integration: 'github', id: 'acme/healthy' }, mapId: '1' },
            },
            observedAt: 3_000,
            value: expect.objectContaining({ title: 'New healthy map' }),
          }),
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project: { integration: 'github', id: 'acme/failing' } },
            attemptedAt: 3_000,
            failure: { kind: 'transient', cause: 'server' },
          }),
        ]),
      )
      expect(
        published.mock.calls.filter(([value]) => value.project.id === 'acme/failing').at(-1)?.[0]
          .health,
      ).toMatchObject({ status: 'degraded', observedAt: 1_000 })
      expect(
        published.mock.calls.some(([value]) => value.health.status === 'authorization-required'),
      ).toBe(false)
    } finally {
      await sources.stop()
    }
  })

  it.each([403, 404])(
    'records generic HTTP-%s as access ambiguity, not authorization or deletion',
    async (status) => {
      const repository: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/roadmap',
        maps: new Map([[1, rawMap(1, 'Known map')]]),
      }
      const { sources, updates, published } = await observedSources([repository])
      try {
        repository.metadataStatus = status
        vi.setSystemTime(2_000)
        await sources.refresh(project)

        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'failed',
              scope: { kind: 'project', project },
              attemptedAt: 2_000,
              failure: { kind: 'access-ambiguous', evidence: `http-${status}` },
            }),
          ]),
        )
        expect(updates.at(-1)).not.toHaveProperty(
          'attempts',
          expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
        )
        expect(published.mock.calls.at(-1)?.[0].health).not.toMatchObject({
          status: 'authorization-required',
        })
        expect(published.mock.calls.at(-1)?.[0].health).toHaveProperty('observedAt', 1_000)
        expect(updates.at(-1)).not.toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: { kind: 'project', project },
              observedAt: 2_000,
            }),
            expect.objectContaining({ kind: 'observed', scope: mapScope, observedAt: 2_000 }),
          ]),
        )
        expect(JSON.stringify(updates)).not.toContain('fixture-token')
      } finally {
        await sources.stop()
      }
    },
  )

  it('records proven HTTP-401 authorization loss as failed evidence rather than absence', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const { sources, updates, published } = await observedSources([repository])
    try {
      repository.metadataStatus = 401
      vi.setSystemTime(2_000)
      await sources.refresh(project)

      expect(published.mock.calls.at(-1)?.[0].health).toMatchObject({
        status: 'authorization-required',
      })
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'project', project },
            attemptedAt: 2_000,
            failure: { kind: 'authorization', proof: 'http-401' },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
      )
      expect(JSON.stringify(updates)).not.toContain('fixture-token')
    } finally {
      await sources.stop()
    }
  })

  it.each([
    ['missing alias', undefined, { kind: 'access-ambiguous', evidence: 'missing-alias' }],
    ['null repository', null, { kind: 'access-ambiguous', evidence: 'null-resource' }],
    [
      'null issue',
      { databaseId: 1, nameWithOwner: 'acme/roadmap', issue: null },
      { kind: 'access-ambiguous', evidence: 'null-resource' },
    ],
    [
      'invalid issue',
      { databaseId: 1, nameWithOwner: 'acme/roadmap', issue: { number: 2, title: 99 } },
      { kind: 'read', cause: 'malformed-response' },
    ],
  ])(
    'commits the validated sibling while a %s names only its failed scope',
    async (_name, alias, failure) => {
      const repository: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/roadmap',
        maps: new Map([
          [1, rawMap(1, 'Old first map')],
          [2, rawMap(2, 'Known second map')],
        ]),
      }
      const { sources, updates } = await observedSources([repository])
      try {
        repository.aliases = new Map([[2, alias]])
        repository.maps.set(1, rawMap(1, 'Validated first map'))
        vi.setSystemTime(2_000)
        await sources.refresh(project)

        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: mapScope,
              observedAt: 2_000,
              value: expect.objectContaining({ title: 'Validated first map' }),
            }),
            expect.objectContaining({
              kind: 'failed',
              scope: { kind: 'map', map: { project, mapId: '2' } },
              attemptedAt: 2_000,
              failure,
            }),
          ]),
        )
        expect(updates.at(-1)).not.toHaveProperty(
          'attempts',
          expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
        )
      } finally {
        await sources.stop()
      }
    },
  )

  it('commits validated maps in an earlier batch while the later batch names its transient failure', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map(
        Array.from({ length: 11 }, (_, index) => [
          index + 1,
          rawMap(index + 1, `Known map ${index + 1}`),
        ]),
      ),
    }
    const { sources, updates } = await observedSources([repository])
    try {
      repository.laterBatchStatus = 503
      repository.maps.set(1, rawMap(1, 'Validated earlier batch'))
      vi.setSystemTime(2_000)
      await sources.refresh(project)

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: mapScope,
            observedAt: 2_000,
            value: expect.objectContaining({ title: 'Validated earlier batch' }),
          }),
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'map', map: { project, mapId: '11' } },
            attemptedAt: 2_000,
            failure: { kind: 'transient', cause: 'server' },
          }),
        ]),
      )
    } finally {
      await sources.stop()
    }
  })

  it.each([
    ['invalid item', [{}]],
    ['invalid list shape', { items: [] }],
    ['malformed later page', Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))],
  ])('does not let a %s prove empty map membership', async (_name, listing) => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const { sources, updates } = await observedSources([repository])
    try {
      repository.listing = listing
      repository.secondPage = [{}]
      vi.setSystemTime(2_000)
      await sources.refresh(project)

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'maps-membership', project },
            attemptedAt: 2_000,
            failure: { kind: 'read', cause: 'malformed-response' },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
      )
    } finally {
      await sources.stop()
    }
  })

  it('limits proven absence to maps omitted by a validated complete membership list', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const { sources, updates } = await observedSources([repository])
    try {
      repository.listing = []
      vi.setSystemTime(2_000)
      await sources.refresh(project)

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'maps-membership', project },
            observedAt: 2_000,
            completeness: { kind: 'complete' },
            value: { members: [] },
          }),
          expect.objectContaining({
            kind: 'proven-absent',
            scope: mapScope,
            observedAt: 2_000,
            proof: { kind: 'complete-membership', parent: { kind: 'maps-membership', project } },
          }),
        ]),
      )
      const membership = updates
        .at(-1)
        ?.attempts.find((attempt) => attempt.scope.kind === 'maps-membership')
      const absence = updates.at(-1)?.attempts.find((attempt) => attempt.kind === 'proven-absent')
      expect(membership?.readSequence).toBe(5)
      expect(absence?.readSequence).toBe(membership?.readSequence)
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({ kind: 'proven-absent', scope: { kind: 'project', project } }),
        ]),
      )
    } finally {
      await sources.stop()
    }
  })

  it.each([true, false])(
    'keeps an admitted opaque blocker key after cross-Connection rename with stable blocker id=%s',
    async (includeBlockerDatabaseId) => {
      const parent: HttpRepository = {
        id: '1',
        nameWithOwner: 'acme/parent',
        maps: new Map([[1, rawMap(1, 'Parent map')]]),
      }
      const dependency: HttpRepository = {
        id: '2',
        nameWithOwner: 'acme/original',
        maps: new Map(),
      }
      const admitted = [
        sourceInput(
          'one',
          parent,
          createGitHubClient({ token: 'fixture-token' }),
          'parent opaque/%2F',
        ),
        sourceInput(
          'two',
          dependency,
          createGitHubClient({ token: 'fixture-token' }),
          'dependency opaque/%2F',
        ),
      ]
      dependency.nameWithOwner = 'acme/renamed'
      parent.aliases = new Map([
        [1, mapWithBlocker('acme/parent', '2', 'acme/renamed', includeBlockerDatabaseId)],
      ])
      const { sources, updates } = await observedSources([parent, dependency], admitted)
      try {
        expect(updates.at(-1)).toHaveProperty(
          'attempts',
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'observed',
              scope: {
                kind: 'ticket',
                ticket: {
                  map: { project: { integration: 'github', id: 'parent opaque/%2F' }, mapId: '1' },
                  ticketId: '10',
                },
              },
              value: expect.objectContaining({
                blockedBy: [
                  expect.objectContaining({
                    reference: {
                      kind: 'registered',
                      project: { integration: 'github', id: 'dependency opaque/%2F' },
                      ticketId: '20',
                    },
                    state: 'open',
                  }),
                ],
              }),
            }),
          ]),
        )
        expect(admitted[1]?.source).toMatchObject({
          repositoryId: '2',
          locator: { nameWithOwner: 'acme/original' },
        })
        expect(admitted[1]).not.toHaveProperty('workspace')
      } finally {
        await sources.stop()
      }
    },
  )

  it('does not let an unregistered blocker name impersonate an admitted opaque Project key', async () => {
    const parent: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/parent',
      maps: new Map([[1, rawMap(1, 'Parent map')]]),
    }
    const registered: HttpRepository = {
      id: '2',
      nameWithOwner: 'acme/registered',
      maps: new Map(),
    }
    parent.aliases = new Map([
      [1, mapWithBlocker('acme/parent', '999', 'external/looks-registered')],
    ])
    const admitted = [
      sourceInput('one', parent, createGitHubClient({ token: 'fixture-token' }), 'parent-key'),
      sourceInput(
        'one',
        registered,
        createGitHubClient({ token: 'fixture-token' }),
        'external/looks-registered',
      ),
    ]
    const { sources, updates } = await observedSources([parent, registered], admitted)
    try {
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'ticket',
              ticket: {
                map: { project: { integration: 'github', id: 'parent-key' }, mapId: '1' },
                ticketId: '10',
              },
            },
            value: expect.objectContaining({
              blockedBy: [
                expect.objectContaining({
                  reference: {
                    kind: 'external',
                    integration: 'github',
                    repositoryId: '999',
                    nameWithOwner: 'external/looks-registered',
                    ticketId: '20',
                  },
                  state: 'open',
                  url: 'https://github.com/external/looks-registered/issues/20',
                }),
              ],
            }),
          }),
        ]),
      )
    } finally {
      await sources.stop()
    }
  })

  it('publishes incomplete ticket membership without inventing an empty complete graph', async () => {
    const parent: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/parent',
      maps: new Map([[1, rawMap(1, 'Parent map')]]),
    }
    const payload = mapWithBlocker('acme/parent', '999', 'external/dependency')
    payload.issue.subIssues.pageInfo.hasNextPage = true
    payload.issue.subIssues.totalCount = 2
    payload.issue.subIssuesSummary.total = 2
    parent.aliases = new Map([[1, payload]])
    const { sources, updates } = await observedSources([parent])
    try {
      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'tickets-membership',
              map: { project: { integration: 'github', id: 'acme/parent' }, mapId: '1' },
            },
            completeness: { kind: 'incomplete', reason: 'pagination' },
            value: {
              members: [
                {
                  map: { project: { integration: 'github', id: 'acme/parent' }, mapId: '1' },
                  ticketId: '10',
                },
              ],
            },
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: {
              kind: 'map',
              map: { project: { integration: 'github', id: 'acme/parent' }, mapId: '1' },
            },
            value: expect.objectContaining({ progress: { total: 2, completed: 0 } }),
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
      )
    } finally {
      await sources.stop()
    }
  })

  it('does not let a failed later pagination request prove empty or complete membership', async () => {
    const repository: HttpRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map([[1, rawMap(1, 'Known map')]]),
    }
    const { sources, updates } = await observedSources([repository])
    try {
      repository.listing = Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))
      repository.secondPage = { message: 'private pagination detail fixture-token' }
      repository.secondPageStatus = 503
      vi.setSystemTime(2_000)
      await sources.refresh(project)

      expect(updates.at(-1)).toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'maps-membership', project },
            attemptedAt: 2_000,
            failure: { kind: 'transient', cause: 'server' },
          }),
        ]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([expect.objectContaining({ kind: 'proven-absent' })]),
      )
      expect(updates.at(-1)).not.toHaveProperty(
        'attempts',
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'maps-membership', project },
            observedAt: 2_000,
            completeness: { kind: 'complete' },
          }),
        ]),
      )
      expect(JSON.stringify(updates)).not.toContain('private pagination detail')
    } finally {
      await sources.stop()
    }
  })
})

function mapWithBlocker(
  nameWithOwner: string,
  blockerRepositoryId: string,
  blockerName: string,
  includeDatabaseId = true,
) {
  return {
    id: 'R_1',
    databaseId: 1,
    nameWithOwner,
    issue: {
      ...rawMap(1, 'Parent map'),
      url: `https://github.com/${nameWithOwner}/issues/1`,
      subIssuesSummary: { total: 1, completed: 0, percentCompleted: 0 },
      subIssues: {
        totalCount: 1,
        pageInfo: { hasNextPage: false },
        nodes: [
          {
            number: 10,
            title: 'Blocked ticket',
            url: `https://github.com/${nameWithOwner}/issues/10`,
            state: 'OPEN',
            stateReason: null,
            createdAt: '2026-08-01T00:00:00Z',
            closedAt: null,
            body: 'Keep this graph and prose.',
            labels: {
              totalCount: 1,
              pageInfo: { hasNextPage: false },
              nodes: [{ name: 'wayfinder:task', color: 'abcdef' }],
            },
            assignees: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
            blockedBy: {
              totalCount: 1,
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  number: 20,
                  title: 'External dependency',
                  url: `https://github.com/${blockerName}/issues/20`,
                  state: 'OPEN',
                  repository: {
                    id: `R_${blockerRepositoryId}`,
                    ...(includeDatabaseId ? { databaseId: Number(blockerRepositoryId) } : {}),
                    nameWithOwner: blockerName,
                  },
                },
              ],
            },
          },
        ],
      },
    },
  }
}
