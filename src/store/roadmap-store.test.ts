import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubClient } from '../github/client.ts'
import { createRoadmapStore } from './roadmap-store.ts'

const SEARCH_RESULT = {
  total_count: 1,
  incomplete_results: false,
  items: [{ number: 1, repository_url: 'https://api.github.com/repos/a/r' }],
}

function mapResponse(title: string, remaining = 5000) {
  return {
    m0: {
      nameWithOwner: 'a/r',
      isPrivate: true,
      issue: {
        number: 1,
        title,
        url: 'https://github.com/a/r/issues/1',
        state: 'OPEN',
        body: '## Destination\n\nSomewhere.\n',
        subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
        subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
      },
    },
    rateLimit: { cost: 2, remaining, limit: 5000, resetAt: '2026-08-07T12:00:00Z' },
  }
}

function fakeClient(graphql: GitHubClient['graphql']): GitHubClient {
  return { graphql, restGet: vi.fn(async () => SEARCH_RESULT) as GitHubClient['restGet'] }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createRoadmapStore', () => {
  it('starts idle and holds nothing until it is started', () => {
    const store = createRoadmapStore(fakeClient(vi.fn()), 'a')
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', projects: [], error: null })
  })

  it('discovers, fetches, and publishes a ready snapshot', async () => {
    const store = createRoadmapStore(
      fakeClient(vi.fn(async () => mapResponse('A map')) as GitHubClient['graphql']),
      'a',
    )
    store.start()
    await store.refresh()

    const snapshot = store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.projects[0]?.openMaps[0]?.title).toBe('A map')
    expect(snapshot.rateLimit?.remaining).toBe(5000)
    expect(snapshot.lastUpdatedAt).not.toBeNull()
  })

  it('notifies subscribers when the snapshot changes', async () => {
    const listener = vi.fn()
    const store = createRoadmapStore(
      fakeClient(vi.fn(async () => mapResponse('A map')) as GitHubClient['graphql']),
      'a',
    )
    store.subscribe(listener)
    store.start()
    await store.refresh()

    expect(listener).toHaveBeenCalled()
  })

  it('returns the same snapshot object between changes, so useSyncExternalStore settles', async () => {
    const store = createRoadmapStore(
      fakeClient(vi.fn(async () => mapResponse('A map')) as GitHubClient['graphql']),
      'a',
    )
    store.start()
    await store.refresh()

    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('keeps the last good projects when a poll fails', async () => {
    let call = 0
    const graphql = vi.fn(async () => {
      call += 1
      if (call === 1) return mapResponse('A map')
      throw new Error('network down')
    })
    const store = createRoadmapStore(fakeClient(graphql as GitHubClient['graphql']), 'a')
    store.start()
    await store.refresh()
    await store.refresh()

    const snapshot = store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toContain('network down')
    expect(snapshot.projects).toHaveLength(1)
  })

  it('shares one in-flight refresh between concurrent callers', async () => {
    const graphql = vi.fn(async () => mapResponse('A map'))
    const store = createRoadmapStore(fakeClient(graphql as GitHubClient['graphql']), 'a')

    await Promise.all([store.refresh(), store.refresh(), store.refresh()])

    expect(graphql).toHaveBeenCalledTimes(1)
  })

  it('re-discovers only on the slow loop, not on every map poll', async () => {
    const client = fakeClient(vi.fn(async () => mapResponse('A map')) as GitHubClient['graphql'])
    const store = createRoadmapStore(client, 'a', { discoveryPollMs: 60_000 })

    await store.refresh()
    await store.refresh()
    expect(client.restGet).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 61_000)
    await store.refresh()
    expect(client.restGet).toHaveBeenCalledTimes(2)
  })

  it('polls on the map interval once started', async () => {
    const graphql = vi.fn(async () => mapResponse('A map'))
    const store = createRoadmapStore(fakeClient(graphql as GitHubClient['graphql']), 'a', {
      mapPollMs: 1000,
      isVisible: () => true,
    })

    store.start()
    await vi.advanceTimersByTimeAsync(3500)

    expect(graphql.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('skips the poll while the tab is hidden, but keeps the loop alive', async () => {
    const graphql = vi.fn(async () => mapResponse('A map'))
    let visible = false
    const store = createRoadmapStore(fakeClient(graphql as GitHubClient['graphql']), 'a', {
      mapPollMs: 1000,
      isVisible: () => visible,
    })

    store.start()
    await vi.advanceTimersByTimeAsync(3500)
    const whileHidden = graphql.mock.calls.length

    visible = true
    await vi.advanceTimersByTimeAsync(2500)

    expect(whileHidden).toBe(1) // only the immediate refresh `start` runs
    expect(graphql.mock.calls.length).toBeGreaterThan(whileHidden)
  })

  it('stretches the interval when the GraphQL budget runs low', async () => {
    const graphql = vi.fn(async () => mapResponse('A map', 200))
    const store = createRoadmapStore(fakeClient(graphql as GitHubClient['graphql']), 'a', {
      mapPollMs: 1000,
      isVisible: () => true,
    })

    store.start()
    await vi.advanceTimersByTimeAsync(3500)

    // remaining < 300 multiplies the interval by 8, so only the initial refresh has run.
    expect(graphql).toHaveBeenCalledTimes(1)
  })

  it('stops polling once the last subscriber leaves', async () => {
    const graphql = vi.fn(async () => mapResponse('A map'))
    const store = createRoadmapStore(fakeClient(graphql as GitHubClient['graphql']), 'a', {
      mapPollMs: 1000,
      isVisible: () => true,
    })

    const stop = store.start()
    await vi.advanceTimersByTimeAsync(1500)
    stop()
    const afterStop = graphql.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)

    expect(graphql.mock.calls.length).toBe(afterStop)
  })

  it('survives StrictMode double-subscribing', async () => {
    const graphql = vi.fn(async () => mapResponse('A map'))
    const store = createRoadmapStore(fakeClient(graphql as GitHubClient['graphql']), 'a', {
      mapPollMs: 1000,
      isVisible: () => true,
    })

    const first = store.start()
    const second = store.start()
    await vi.advanceTimersByTimeAsync(1500)
    first()

    // The second subscriber still holds the loop open.
    const before = graphql.mock.calls.length
    await vi.advanceTimersByTimeAsync(1500)
    expect(graphql.mock.calls.length).toBeGreaterThan(before)
    second()
  })
})
