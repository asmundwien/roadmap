import { describe, expect, it, vi } from 'vitest'
import type { GitHubClient } from './client.ts'
import type { MapRef } from './discovery.ts'
import { buildMapsQuery, fetchMaps, readMapsResponse } from './map-query.ts'

const REFS: MapRef[] = [
  { owner: 'a', repo: 'roadmap', nameWithOwner: 'a/roadmap', number: 1 },
  { owner: 'a', repo: 'gainstage', nameWithOwner: 'a/gainstage', number: 1 },
]

function repository(nameWithOwner: string) {
  return {
    nameWithOwner,
    isPrivate: true,
    issue: {
      number: 1,
      title: 'A map',
      url: `https://github.com/${nameWithOwner}/issues/1`,
      state: 'OPEN' as const,
      updatedAt: '2026-08-01T12:00:00Z',
      closedAt: null,
      body: '',
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
    },
  }
}

describe('buildMapsQuery', () => {
  it('gives each map its own alias and its own variables', () => {
    const { query, variables } = buildMapsQuery(REFS)

    expect(query).toContain('m0: repository(owner: $o0, name: $n0)')
    expect(query).toContain('m1: repository(owner: $o1, name: $n1)')
    expect(variables).toMatchObject({
      o0: 'a',
      n0: 'roadmap',
      i0: 1,
      o1: 'a',
      n1: 'gainstage',
      i1: 1,
    })
  })

  it('passes repo names as variables, so a name can never break the query', () => {
    const { query, variables } = buildMapsQuery([
      { owner: 'a', repo: 'weird") { x } #', nameWithOwner: 'a/weird', number: 3 },
    ])

    expect(query).not.toContain('weird')
    expect(variables.n0).toBe('weird") { x } #')
  })

  it('asks for the budget alongside the data', () => {
    expect(buildMapsQuery(REFS).query).toContain('rateLimit { cost remaining limit resetAt }')
  })

  it('fetches sub-issues and their blocked-by edges in the one query', () => {
    const { query } = buildMapsQuery(REFS)
    expect(query).toContain('subIssues(first: 100)')
    expect(query).toContain('blockedBy(first: 50)')
  })

  it('fetches the timestamps recency and history ordering derive from', () => {
    const { query } = buildMapsQuery(REFS)
    expect(query).toContain('updatedAt')
    expect(query).toContain('closedAt')
  })
})

describe('readMapsResponse', () => {
  it('pairs each alias back up with the ref that asked for it', () => {
    const result = readMapsResponse(REFS, {
      m0: repository('a/roadmap'),
      m1: repository('a/gainstage'),
    })

    expect(result.maps.map((map) => map.ref.nameWithOwner)).toEqual(['a/roadmap', 'a/gainstage'])
    expect(result.missing).toEqual([])
  })

  it('reports a ref the API returned nothing for instead of dropping it silently', () => {
    const result = readMapsResponse(REFS, { m0: repository('a/roadmap'), m1: null })

    expect(result.maps).toHaveLength(1)
    expect(result.missing).toEqual([REFS[1]])
  })

  it('treats a repo whose issue vanished as missing', () => {
    const result = readMapsResponse([REFS[0] as MapRef], {
      m0: { nameWithOwner: 'a/roadmap', isPrivate: true, issue: null },
    })

    expect(result.maps).toEqual([])
    expect(result.missing).toHaveLength(1)
  })
})

describe('fetchMaps', () => {
  function clientReturning(impl: GitHubClient['graphql']): GitHubClient {
    return { graphql: impl, restGet: vi.fn() }
  }

  it('makes no request at all when nothing was discovered', async () => {
    const graphql = vi.fn()
    const result = await fetchMaps(clientReturning(graphql), [])

    expect(graphql).not.toHaveBeenCalled()
    expect(result).toEqual({ maps: [], rateLimit: null, missing: [] })
  })

  it('batches many maps into few requests', async () => {
    const refs = Array.from({ length: 25 }, (_, i) => ({
      owner: 'a',
      repo: `r${i}`,
      nameWithOwner: `a/r${i}`,
      number: 1,
    }))
    const graphql = vi.fn(async () => ({ rateLimit: null }))

    await fetchMaps(clientReturning(graphql as unknown as GitHubClient['graphql']), refs)

    // 25 maps at 10 per request.
    expect(graphql).toHaveBeenCalledTimes(3)
  })

  it('keeps the maps a surviving batch returned when another batch fails', async () => {
    const refs = Array.from({ length: 11 }, (_, i) => ({
      owner: 'a',
      repo: `r${i}`,
      nameWithOwner: `a/r${i}`,
      number: 1,
    }))
    let call = 0
    const graphql = vi.fn(async () => {
      call += 1
      if (call === 1) throw new Error('boom')
      return { m0: repository('a/r10'), rateLimit: null }
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await fetchMaps(
      clientReturning(graphql as unknown as GitHubClient['graphql']),
      refs,
    )

    expect(result.maps).toHaveLength(1)
  })

  it('throws when every batch fails, rather than reporting an empty roadmap', async () => {
    const graphql = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(
      fetchMaps(clientReturning(graphql as unknown as GitHubClient['graphql']), REFS),
    ).rejects.toThrow('boom')
  })
})
