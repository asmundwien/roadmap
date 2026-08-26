import type { ProjectRegistration } from '@roadmap/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfiguredConnection } from '../application/configuration.ts'
import type { AdapterSlice } from '../store.ts'
import { createGitHubAdapter } from './adapter.ts'
import { type GitHubClient, GitHubError } from './client.ts'
import { GitHubConnectionError } from './connections.ts'
import type { RawMapIssue, RawRepository } from './map-query.ts'

interface FakeRepository {
  id: string
  nameWithOwner: string
  private?: boolean
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

function connection(id: string): ConfiguredConnection {
  return {
    id,
    integration: 'github',
    name: id,
    builtIn: false,
    githubIdentity: { id: `user-${id}`, login: id },
  }
}

function registration(
  connectionId: string,
  repository: FakeRepository,
  key = repository.nameWithOwner,
): ProjectRegistration {
  return {
    key: { integration: 'github', id: key },
    connectionId,
    locator: {
      integration: 'github',
      repositoryId: repository.id,
      nameWithOwner: repository.nameWithOwner,
    },
    workspace: { path: `/work/${repository.id}`, gitIdentity: repository.id },
  }
}
function availableRepository(
  repositories: FakeRepository[],
  id: string | undefined,
): FakeRepository {
  const repository = repositories.find((candidate) => candidate.id === id)
  if (repository?.failure) throw repository.failure
  if (!repository || repository.unavailable) throw new GitHubError('Not Found', 404)
  return repository
}

function fakeClient(repositories: FakeRepository[], remaining = 200) {
  const restPaths: string[] = []
  const graphqlCalls: Record<string, unknown>[] = []
  const graphql: GitHubClient['graphql'] = async <T>(
    _query: string,
    variables: Record<string, unknown> = {},
  ) => {
    graphqlCalls.push(variables)
    const firstNameWithOwner = `${variables.o0}/${variables.n0}`
    const firstRepository = repositories.find(
      (candidate) => candidate.nameWithOwner === firstNameWithOwner,
    )
    await firstRepository?.graphqlGate
    const response: Record<string, RawRepository | object | null> = {
      rateLimit: {
        cost: 1,
        remaining: firstRepository?.rateLimitRemaining ?? remaining,
        limit: 5000,
        resetAt: '2026-08-22T12:00:00Z',
      },
    }
    for (let index = 0; `o${index}` in variables; index += 1) {
      const nameWithOwner = `${variables[`o${index}`]}/${variables[`n${index}`]}`
      const repository = repositories.find((candidate) => candidate.nameWithOwner === nameWithOwner)
      const number = Number(variables[`i${index}`])
      response[`m${index}`] = repository
        ? {
            nameWithOwner,
            isPrivate: repository.private ?? false,
            issue: repository.maps.get(number) ?? null,
          }
        : null
    }
    return response as T
  }
  const client: GitHubClient = {
    graphql,
    async restGet<T>(path: string): Promise<T> {
      restPaths.push(path)
      const byId = /^\/repositories\/([^/?]+)$/.exec(path)
      if (byId) {
        const repository = availableRepository(repositories, byId[1])
        return {
          id: repository.id,
          full_name: repository.nameWithOwner,
          private: repository.private ?? false,
        } as T
      }
      const issues = /^\/repos\/([^/]+)\/([^/]+)\/issues\?/.exec(path)
      if (issues) {
        const nameWithOwner = `${decodeURIComponent(issues[1] ?? '')}/${decodeURIComponent(issues[2] ?? '')}`
        const repository = repositories.find(
          (candidate) => candidate.nameWithOwner === nameWithOwner,
        )
        if (!repository) throw new GitHubError('Not Found', 404)
        return [...repository.maps.keys()].map((number) => ({ number })) as T
      }
      throw new Error(`Unexpected REST path ${path}`)
    },
  }
  return { client, restPaths, graphqlCalls }
}

function deferredGate(): { promise: Promise<void>; open(): void } {
  let open: () => void = () => {
    throw new Error('Gate was not initialized.')
  }
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

afterEach(() => vi.useRealTimers())

describe('createGitHubAdapter', () => {
  it('reconciles only explicit registrations across isolated Connection clients', async () => {
    const first = {
      id: '1',
      nameWithOwner: 'acme/renamed',
      private: true,
      maps: new Map([[16, rawMap(16, 'Current map')]]),
    }
    const empty = { id: '2', nameWithOwner: 'acme/empty', maps: new Map<number, RawMapIssue>() }
    const second = {
      id: '3',
      nameWithOwner: 'other/roadmap',
      maps: new Map([[7, rawMap(7, 'Other map')]]),
    }
    const clients = new Map([
      ['token-one', fakeClient([first, empty])],
      ['token-two', fakeClient([second])],
    ])
    const tokens = vi.fn(async (connectionId: string) => `token-${connectionId}`)
    const updates: AdapterSlice[] = []
    const adapter = createGitHubAdapter({
      connections: [connection('one'), connection('two')],
      registrations: [
        registration('one', first, 'acme/original'),
        registration('one', empty),
        registration('two', second),
      ],
      accessToken: tokens,
      createClient: (token) => {
        const found = clients.get(token)
        if (!found) throw new Error('unexpected token')
        return found.client
      },
    })

    await adapter.start({ update: (slice) => updates.push(slice) })

    expect(tokens.mock.calls.map(([id]) => id)).toEqual(['one', 'two'])
    expect(
      updates
        .at(-1)
        ?.projects.map((project) => project.key.id)
        .sort(),
    ).toEqual(['acme/empty', 'acme/original', 'other/roadmap'])
    const renamed = updates.at(-1)?.projects.find((project) => project.key.id === 'acme/original')
    expect(renamed).toMatchObject({
      name: 'acme/renamed',
      visibility: 'private',
      sourceUrl: 'https://github.com/acme/renamed',
    })
    expect(renamed?.openMaps[0]).toMatchObject({
      project: { integration: 'github', id: 'acme/original' },
      title: 'Current map',
    })
    expect(
      updates.at(-1)?.projects.find((project) => project.key.id === 'acme/empty'),
    ).toMatchObject({
      openMaps: [],
      closedMaps: [],
    })
    expect([...clients.values()].flatMap((value) => value.restPaths)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('/search/issues')]),
    )
    await adapter.stop()
  })

  it('contains a rejected refresh credential to one Connection with a safe recovery action', async () => {
    const reachable = {
      id: '2',
      nameWithOwner: 'other/roadmap',
      maps: new Map<number, RawMapIssue>(),
    }
    const { client } = fakeClient([reachable])
    const availability = vi.fn()
    const warn = vi.fn()
    const updates: AdapterSlice[] = []
    const adapter = createGitHubAdapter({
      connections: [connection('broken'), connection('healthy')],
      registrations: [
        registration('broken', {
          id: '1',
          nameWithOwner: 'acme/private',
          maps: new Map<number, RawMapIssue>(),
        }),
        registration('healthy', reachable),
      ],
      accessToken: async (id) => {
        if (id === 'broken') {
          throw new GitHubConnectionError('bad-refresh-token', 'private credential detail')
        }
        return 'healthy-token'
      },
      createClient: () => client,
      onConnectionAvailability: availability,
      logger: { warn },
    })

    await adapter.start({ update: (slice) => updates.push(slice) })

    expect(updates.at(-1)?.projects.map((project) => project.key.id)).toEqual(['other/roadmap'])
    expect(updates.at(-1)?.unreachable).toEqual([
      expect.objectContaining({
        project: { integration: 'github', id: 'acme/private' },
        reason: 'GitHub rejected the stored authorization. Reauthenticate this Connection.',
      }),
    ])
    expect(availability).toHaveBeenCalledWith(
      'broken',
      expect.objectContaining({ status: 'authorization-required' }),
    )
    expect(JSON.stringify(updates)).not.toContain('private credential detail')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private credential detail')
    await adapter.stop()
  })

  it('keeps the last-good slice, degrades after repeated failures, and recovers cleanly', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const first: FakeRepository = {
      id: '1',
      nameWithOwner: 'acme/first',
      maps: new Map([[1, rawMap(1, 'First map')]]),
    }
    const second: FakeRepository = {
      id: '2',
      nameWithOwner: 'acme/second',
      maps: new Map([[2, rawMap(2, 'Second map')]]),
    }
    const { client } = fakeClient([first, second], 4_000)
    const availability = vi.fn()
    const warn = vi.fn()
    const updates: AdapterSlice[] = []
    const adapter = createGitHubAdapter({
      connections: [connection('one')],
      registrations: [registration('one', first), registration('one', second)],
      accessToken: async () => 'token',
      createClient: () => client,
      onConnectionAvailability: availability,
      logger: { warn },
      reconcileMs: 10,
    })

    await adapter.start({ update: (slice) => updates.push(slice) })
    expect(updates.at(-1)?.projects.map((project) => project.key.id)).toEqual([
      'acme/first',
      'acme/second',
    ])

    second.failure = new GitHubError('Service unavailable', 503)
    await vi.advanceTimersByTimeAsync(10)

    expect(availability).toHaveBeenLastCalledWith('one', {
      status: 'available',
      observedAt: 1_000,
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]?.projects.map((project) => project.key.id)).toEqual([
      'acme/first',
      'acme/second',
    ])
    expect(updates[0]?.unreachable).toEqual([])

    await vi.advanceTimersByTimeAsync(10)
    expect(availability).toHaveBeenLastCalledWith('one', {
      status: 'degraded',
      cause:
        'GitHub observations are temporarily failing; showing data from the last successful observation.',
      observedAt: 1_000,
    })
    expect(warn).toHaveBeenLastCalledWith(
      'GitHub observation failed connection=one stage=repository class=transient durationMs=10 retryInMs=20',
    )
    expect(updates).toHaveLength(1)

    second.failure = undefined
    await vi.advanceTimersByTimeAsync(19)
    expect(availability).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)

    expect(availability).toHaveBeenLastCalledWith('one', {
      status: 'available',
      observedAt: 1_040,
    })
    expect(updates).toHaveLength(1)
    await adapter.stop()
  })

  it('contains a repository 404 to that Project and recovers its stable key', async () => {
    const unavailable: FakeRepository = {
      id: '1',
      nameWithOwner: 'acme/roadmap',
      maps: new Map<number, RawMapIssue>(),
      unavailable: true,
    }
    const reachable: FakeRepository = {
      id: '2',
      nameWithOwner: 'acme/other',
      maps: new Map([[2, rawMap(2, 'Other map')]]),
    }
    const { client } = fakeClient([unavailable, reachable])
    const updates: AdapterSlice[] = []
    const adapter = createGitHubAdapter({
      connections: [connection('one')],
      registrations: [
        registration('one', unavailable, 'stable/route'),
        registration('one', reachable),
      ],
      accessToken: async () => 'token',
      createClient: () => client,
    })
    await adapter.start({ update: (slice) => updates.push(slice) })
    expect(updates.at(-1)?.projects.map((project) => project.key.id)).toEqual(['acme/other'])
    expect(updates.at(-1)?.unreachable[0]?.project.id).toBe('stable/route')

    unavailable.unavailable = false
    expect(await adapter.refresh({ integration: 'github', id: 'stable/route' })).toBe(true)

    expect(updates.at(-1)?.projects.map((project) => project.key.id)).toEqual([
      'stable/route',
      'acme/other',
    ])
    expect(updates.at(-1)?.unreachable).toEqual([])
    await adapter.stop()
  })

  it('paces each Connection from its own rate budget', async () => {
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
    const adapter = createGitHubAdapter({
      connections: [connection('slow'), connection('fast')],
      registrations: [registration('slow', slowRepository), registration('fast', fastRepository)],
      accessToken: async (id) => id,
      createClient: (token) => (token === 'slow' ? slow.client : fast.client),
      reconcileMs: 10,
    })
    await adapter.start({ update() {} })
    expect(slow.graphqlCalls).toHaveLength(1)
    expect(fast.graphqlCalls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10)
    expect(slow.graphqlCalls).toHaveLength(1)
    expect(fast.graphqlCalls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(70)
    expect(slow.graphqlCalls).toHaveLength(2)
    expect(fast.graphqlCalls.length).toBeGreaterThan(2)
    await adapter.stop()
  })
  it('keeps the most conservative concurrent rate-limit observation', async () => {
    const gate = deferredGate()
    const older: FakeRepository = {
      id: '1',
      nameWithOwner: 'acme/older',
      maps: new Map([[1, rawMap(1, 'Older response')]]),
      rateLimitRemaining: 4_000,
      graphqlGate: gate.promise,
    }
    const newer: FakeRepository = {
      id: '2',
      nameWithOwner: 'acme/newer',
      maps: new Map([[2, rawMap(2, 'Newer response')]]),
      rateLimitRemaining: 100,
    }
    const { client, graphqlCalls } = fakeClient([older, newer])
    const adapter = createGitHubAdapter({
      connections: [connection('one')],
      registrations: [registration('one', older), registration('one', newer)],
      accessToken: async () => 'token',
      createClient: () => client,
    })

    const start = adapter.start({ update() {} })
    await vi.waitFor(() => expect(graphqlCalls).toHaveLength(2))
    gate.open()
    await start

    expect(adapter.diagnostics().rateLimit?.remaining).toBe(100)
    await adapter.stop()
  })
})
