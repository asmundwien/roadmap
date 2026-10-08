import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGitHubClient, type GitHubClient } from './client.ts'
import { buildMapsQuery, fetchMaps, readMapsResponse } from './map-query.ts'
import type { MapRef } from './repository.ts'

const REFS: MapRef[] = [
  { owner: 'a', repo: 'roadmap', nameWithOwner: 'a/roadmap', number: 1 },
  { owner: 'a', repo: 'gainstage', nameWithOwner: 'a/gainstage', number: 1 },
]

function repository(nameWithOwner: string) {
  return {
    id: `R_${nameWithOwner}`,
    databaseId: nameWithOwner === 'a/gainstage' ? 2 : 1,
    nameWithOwner,
    issue: {
      number: 1,
      title: 'A map',
      url: `https://github.com/${nameWithOwner}/issues/1`,
      state: 'OPEN',
      updatedAt: '2026-08-01T12:00:00Z',
      closedAt: null,
      body: '',
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
    },
  }
}

function client(data: Record<string, unknown>): GitHubClient {
  return {
    graphql: async () => ({ data, errors: [] }),
    restGet: async () => {
      throw new Error('Map query fixtures do not make REST requests')
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }))
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
    expect(result).toHaveProperty('failures', [])
  })

  it('records a null repository alias as access ambiguity, not deletion', () => {
    const result = readMapsResponse(REFS, { m0: repository('a/roadmap'), m1: null })

    expect(result.maps.map((map) => map.ref.nameWithOwner)).toEqual(['a/roadmap'])
    expect(result).toHaveProperty('failures', [
      expect.objectContaining({
        ref: REFS[1],
        failure: expect.objectContaining({ kind: 'access-ambiguous' }),
      }),
    ])
  })

  it('records a null issue as access ambiguity instead of proving absence', () => {
    const result = readMapsResponse(REFS.slice(0, 1), {
      m0: { ...repository('a/roadmap'), issue: null },
    })

    expect(result.maps).toEqual([])
    expect(result).toHaveProperty('failures', [
      expect.objectContaining({
        ref: REFS[0],
        failure: expect.objectContaining({ kind: 'access-ambiguous' }),
      }),
    ])
  })
})

describe('fetchMaps', () => {
  it('makes no request at all when nothing was discovered', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMaps(createGitHubClient({ token: 'fixture-token' }), [])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.maps).toEqual([])
  })

  it('refines unknown client data and records the actual successful read time', async () => {
    const result = await fetchMaps(
      client({ m0: repository('a/roadmap') }),
      REFS.slice(0, 1),
      () => 1_234,
    )

    expect(result.maps).toEqual([
      expect.objectContaining({
        ref: REFS[0],
        attemptedAt: 1_234,
        observedAt: 1_234,
        ticketsCompleteness: { kind: 'complete' },
      }),
    ])
    expect(result.failures).toEqual([])
  })

  it.each([
    ['unreadable connection', null, { kind: 'incomplete', reason: 'unreadable' }],
    [
      'later page',
      { totalCount: 1, pageInfo: { hasNextPage: true }, nodes: [] },
      { kind: 'incomplete', reason: 'pagination' },
    ],
    [
      'missing counted child',
      { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [] },
      { kind: 'incomplete', reason: 'pagination' },
    ],
    [
      'complete empty connection',
      { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
      { kind: 'complete' },
    ],
  ])(
    'keeps map prose but distinguishes %s from complete ticket membership',
    async (_name, subIssues, completeness) => {
      const data = {
        m0: {
          ...repository('a/roadmap'),
          issue: {
            ...repository('a/roadmap').issue,
            body: 'Retain independently readable map prose.',
            subIssues,
          },
        },
      }

      const result = await fetchMaps(client(data), REFS.slice(0, 1), () => 2_000)

      expect(result.maps[0]?.issue.body).toBe('Retain independently readable map prose.')
      expect(result.maps[0]?.ticketsCompleteness).toEqual(completeness)
      expect(result.failures).toEqual([])
    },
  )

  it.each([
    ['missing alias', {}],
    ['null repository', { m1: null }],
    [
      'null issue',
      { m1: { id: 'R_gainstage', databaseId: 2, nameWithOwner: 'a/gainstage', issue: null } },
    ],
    [
      'invalid issue',
      {
        m1: {
          id: 'R_gainstage',
          databaseId: 2,
          nameWithOwner: 'a/gainstage',
          issue: { number: 1, title: 99 },
        },
      },
    ],
    [
      'wrong issue identity',
      {
        m1: {
          ...repository('a/gainstage'),
          issue: { ...repository('a/gainstage').issue, number: 99 },
        },
      },
    ],
    ['wrong repository identity', { m1: repository('a/unregistered') }],
  ])('preserves a validated alias beside a %s', async (_name, failedAlias) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ m0: repository('a/roadmap'), ...failedAlias })),
    )

    const result = await fetchMaps(createGitHubClient({ token: 'fixture-token' }), REFS)

    expect(result.maps.map((map) => map.ref.nameWithOwner)).toEqual(['a/roadmap'])
    expect(result).toHaveProperty('failures', [expect.objectContaining({ ref: REFS[1] })])
  })

  it('commits validated first-batch maps when a later batch fails', async () => {
    const refs = Array.from({ length: 11 }, (_, index) => ({
      owner: 'a',
      repo: `r${index}`,
      nameWithOwner: `a/r${index}`,
      number: 1,
    }))
    const firstBatch = Object.fromEntries(
      refs.slice(0, 10).map((ref, index) => [`m${index}`, repository(ref.nameWithOwner)]),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(firstBatch))
        .mockResolvedValueOnce(new Response('private provider detail', { status: 503 })),
    )

    const result = await fetchMaps(createGitHubClient({ token: 'fixture-token' }), refs)

    expect(result.maps.map((map) => map.ref.repo)).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
      'r4',
      'r5',
      'r6',
      'r7',
      'r8',
      'r9',
    ])
    expect(result).toHaveProperty('failures', [
      expect.objectContaining({
        ref: refs[10],
        failure: expect.objectContaining({ kind: 'transient' }),
      }),
    ])
    expect(JSON.stringify(result)).not.toContain('private provider detail')
  })

  it('returns named failures rather than empty success when every batch has execution errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ errors: [{ message: 'private execution detail' }] })),
      ),
    )

    const result = await fetchMaps(createGitHubClient({ token: 'fixture-token' }), REFS)

    expect(result.maps).toEqual([])
    expect(result).toHaveProperty('failures', [
      expect.objectContaining({
        ref: REFS[0],
        failure: expect.objectContaining({ kind: 'execution' }),
      }),
      expect.objectContaining({
        ref: REFS[1],
        failure: expect.objectContaining({ kind: 'execution' }),
      }),
    ])
    expect(JSON.stringify(result)).not.toContain('private execution detail')
  })

  it('commits validated data outside the named path of a partial execution error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { m0: repository('a/roadmap'), m1: null },
              errors: [{ path: ['m1', 'issue'], message: 'private execution detail' }],
            }),
          ),
      ),
    )

    const result = await fetchMaps(createGitHubClient({ token: 'fixture-token' }), REFS)

    expect(result.maps.map((map) => map.ref.nameWithOwner)).toEqual(['a/roadmap'])
    expect(result).toHaveProperty('failures', [
      expect.objectContaining({ ref: REFS[1], failure: { kind: 'execution', cause: 'provider' } }),
    ])
    expect(JSON.stringify(result)).not.toContain('private execution detail')
  })

  it.each([
    ['unattributed error', [{ message: 'private execution detail' }]],
    ['unknown alias path', [{ path: ['other', 'issue'], message: 'private execution detail' }]],
    ['empty error path', [{ path: [], message: 'private execution detail' }]],
    [
      'one known and one unknown path',
      [
        { path: ['m1', 'issue'], message: 'private execution detail' },
        { path: ['other'], message: 'private execution detail' },
      ],
    ],
    [
      'errors for both aliases',
      [
        { path: ['m0', 'issue'], message: 'private execution detail' },
        { path: ['m1', 'issue'], message: 'private execution detail' },
      ],
    ],
  ])(
    'does not certify aliases outside a provably unaffected scope after an %s',
    async (_name, errors) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                data: { m0: repository('a/roadmap'), m1: repository('a/gainstage') },
                errors,
              }),
            ),
        ),
      )

      const result = await fetchMaps(createGitHubClient({ token: 'fixture-token' }), REFS)

      expect(result.maps).toEqual([])
      expect(result).toHaveProperty('failures', [
        expect.objectContaining({
          ref: REFS[0],
          failure: { kind: 'execution', cause: 'provider' },
        }),
        expect.objectContaining({
          ref: REFS[1],
          failure: { kind: 'execution', cause: 'provider' },
        }),
      ])
      expect(JSON.stringify(result)).not.toContain('private execution detail')
    },
  )
})
