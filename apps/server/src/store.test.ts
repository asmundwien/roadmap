import type { Snapshot } from '@roadmap/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubClient } from './github/client.ts'
import type { RawMapIssue, RawRepository } from './github/map-query.ts'
import { createSnapshotStore } from './store.ts'

/** Fast enough that tests settle in milliseconds, long enough to observe coalescing. */
const DEBOUNCE_MS = 5

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

interface FakeRepo {
  nameWithOwner: string
  maps: Map<number, RawMapIssue | null>
}

/**
 * A GitHub double serving discovery (REST search) and the aliased maps query (GraphQL) from an
 * in-memory fixture the test mutates between polls.
 */
function fakeGitHub(repos: FakeRepo[]) {
  const graphqlCalls: string[][] = []
  let searches = 0

  const client: GitHubClient = {
    restGet: async <T>(): Promise<T> => {
      searches += 1
      const items = repos.flatMap((repository) =>
        [...repository.maps.entries()]
          .filter(([, issue]) => issue !== null)
          .map(([number]) => ({
            number,
            repository_url: `https://api.github.com/repos/${repository.nameWithOwner}`,
          })),
      )
      return { total_count: items.length, incomplete_results: false, items } as T
    },
    graphql: async <T>(_query: string, variables: Record<string, unknown> = {}): Promise<T> => {
      const response: Record<string, RawRepository | { remaining: number } | null> = {
        rateLimit: { remaining: 4000 },
      }
      const asked: string[] = []
      for (let index = 0; `o${index}` in variables; index += 1) {
        const nameWithOwner = `${variables[`o${index}`]}/${variables[`n${index}`]}`
        const number = variables[`i${index}`] as number
        asked.push(`${nameWithOwner}#${number}`)
        const repository = repos.find((candidate) => candidate.nameWithOwner === nameWithOwner)
        response[`m${index}`] = repository
          ? { nameWithOwner, isPrivate: false, issue: repository.maps.get(number) ?? null }
          : null
      }
      graphqlCalls.push(asked)
      return response as T
    },
  }

  return { client, graphqlCalls, searchCount: () => searches }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 6))
}

const REF_16 = { owner: 'a', repo: 'roadmap', nameWithOwner: 'a/roadmap', number: 16 }

describe('createSnapshotStore', () => {
  it('baselines into one snapshot and hands it to late subscribers', async () => {
    const { client } = fakeGitHub([
      { nameWithOwner: 'a/roadmap', maps: new Map([[16, rawMap(16, 'v3')]]) },
    ])
    const store = createSnapshotStore(client, 'a', { debounceMs: DEBOUNCE_MS })
    await store.reconcile('baseline')

    expect(store.snapshot().projects).toHaveLength(1)
    expect(store.knownMaps()).toEqual([REF_16])

    const late = vi.fn<(snapshot: Snapshot) => void>()
    store.onChange(late)
    expect(late).toHaveBeenCalledOnce()
    store.stop()
  })

  it('refetches only the named map on a precise invalidation, and broadcasts the change', async () => {
    const roadmap: FakeRepo = {
      nameWithOwner: 'a/roadmap',
      maps: new Map([[16, rawMap(16, 'v3')]]),
    }
    const { client, graphqlCalls } = fakeGitHub([roadmap])
    const store = createSnapshotStore(client, 'a', { debounceMs: DEBOUNCE_MS })
    await store.reconcile('baseline')

    const changes = vi.fn<(snapshot: Snapshot) => void>()
    store.onChange(changes)
    changes.mockClear()

    roadmap.maps.set(16, rawMap(16, 'v3 — renamed'))
    store.invalidate({ kind: 'maps', refs: [REF_16] })
    await settle()

    expect(graphqlCalls.at(-1)).toEqual(['a/roadmap#16'])
    expect(changes).toHaveBeenCalledOnce()
    const title = changes.mock.calls[0]?.[0].projects[0]?.openMaps[0]?.title
    expect(title).toBe('v3 — renamed')
    store.stop()
  })

  it('coalesces a burst of invalidations into one refetch and stays silent when nothing changed', async () => {
    const { client, graphqlCalls } = fakeGitHub([
      { nameWithOwner: 'a/roadmap', maps: new Map([[16, rawMap(16, 'v3')]]) },
    ])
    const store = createSnapshotStore(client, 'a', { debounceMs: DEBOUNCE_MS })
    await store.reconcile('baseline')
    const fetchesAfterBaseline = graphqlCalls.length

    const changes = vi.fn()
    store.onChange(changes)
    changes.mockClear()

    store.invalidate({ kind: 'maps', refs: [REF_16] })
    store.invalidate({ kind: 'repos', repos: ['a/roadmap'] })
    store.invalidate({ kind: 'maps', refs: [REF_16] })
    await settle()

    expect(graphqlCalls.length).toBe(fetchesAfterBaseline + 1)
    expect(changes).not.toHaveBeenCalled()
    store.stop()
  })

  it('registers a webhook-announced map that discovery has not seen yet', async () => {
    const fresh: FakeRepo = { nameWithOwner: 'a/fresh', maps: new Map() }
    const { client } = fakeGitHub([
      { nameWithOwner: 'a/roadmap', maps: new Map([[16, rawMap(16, 'v3')]]) },
      fresh,
    ])
    const store = createSnapshotStore(client, 'a', { debounceMs: DEBOUNCE_MS })
    await store.reconcile('baseline')

    fresh.maps.set(1, rawMap(1, 'new effort'))
    store.invalidate({
      kind: 'maps',
      refs: [{ owner: 'a', repo: 'fresh', nameWithOwner: 'a/fresh', number: 1 }],
    })
    await settle()

    expect(store.knownMaps()).toHaveLength(2)
    expect(store.snapshot().projects.map((project) => project.nameWithOwner)).toContain('a/fresh')
    store.stop()
  })

  it('marks a map the API no longer returns as unreachable rather than pretending', async () => {
    const roadmap: FakeRepo = {
      nameWithOwner: 'a/roadmap',
      maps: new Map([[16, rawMap(16, 'v3')]]),
    }
    const { client } = fakeGitHub([roadmap])
    const store = createSnapshotStore(client, 'a', { debounceMs: DEBOUNCE_MS })
    await store.reconcile('baseline')

    // The issue vanishes from the API, but discovery hasn't swept yet: a targeted refetch finds
    // nothing there.
    roadmap.maps.set(16, null)
    store.invalidate({ kind: 'maps', refs: [REF_16] })
    await settle()

    expect(store.snapshot().unreachable).toEqual([REF_16])
    expect(store.snapshot().projects).toHaveLength(0)
    store.stop()
  })

  it('runs a full sweep on a discovery invalidation, dropping maps discovery no longer finds', async () => {
    const roadmap: FakeRepo = {
      nameWithOwner: 'a/roadmap',
      maps: new Map([[16, rawMap(16, 'v3')]]),
    }
    const { client, searchCount } = fakeGitHub([roadmap])
    const store = createSnapshotStore(client, 'a', { debounceMs: DEBOUNCE_MS })
    await store.reconcile('baseline')
    expect(searchCount()).toBe(1)

    roadmap.maps.delete(16)
    store.invalidate({ kind: 'discovery' })
    await settle()

    expect(searchCount()).toBe(2)
    expect(store.knownMaps()).toHaveLength(0)
    expect(store.snapshot().projects).toHaveLength(0)
    expect(store.snapshot().unreachable).toHaveLength(0)
    store.stop()
  })
})
