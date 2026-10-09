import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceFailure } from '../observation/source.ts'
import { GitHubAccessError, type GitHubAccessFailure } from '../projects/registry.ts'
import { createGitHubClient, GitHubError } from './client.ts'

const CONFIG = { token: 't0ken', user: 'asmundwien' }
const RATE_LIMIT_RESPONSES: { status: number; headers: Record<string, string> }[] = [
  { status: 429, headers: {} },
  { status: 403, headers: { 'X-RateLimit-Remaining': '0' } },
  { status: 403, headers: { 'Retry-After': '60' } },
]

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers()
  if (init.etag) headers.set('ETag', init.etag)
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Connection token resolution', () => {
  const accessFailures: { failure: GitHubAccessFailure; expected: SourceFailure }[] = [
    { failure: 'network', expected: { kind: 'transient', cause: 'network' } },
    { failure: 'malformed-response', expected: { kind: 'read', cause: 'malformed-response' } },
    { failure: 'unavailable', expected: { kind: 'access-unavailable' } },
    {
      failure: 'authorization-required',
      expected: { kind: 'authorization', proof: 'authorization-required' },
    },
    {
      failure: 'rejected-credential',
      expected: { kind: 'authorization', proof: 'rejected-credential' },
    },
    {
      failure: 'account-mismatch',
      expected: { kind: 'authorization', proof: 'account-mismatch' },
    },
  ]

  it.each(accessFailures)(
    'preserves classified $failure without a provider request or private token error detail',
    async ({ failure, expected }) => {
      const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: {} }))
      vi.stubGlobal('fetch', fetchMock)
      const classified = new GitHubAccessError(failure)
      classified.message = 'private token-resolution detail harmless-secret'
      const client = createGitHubClient({
        token: async () => {
          throw classified
        },
      })

      for (const read of [
        () => client.restGet('/repositories/84'),
        () => client.graphql('query {}'),
      ]) {
        const error = await read().catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error).toHaveProperty('failure', expected)
        expect(error).not.toHaveProperty('cause')
        expect(error instanceof Error ? error.message : '').not.toContain(
          'private token-resolution',
        )
        expect(JSON.stringify(error)).not.toContain('harmless-secret')
      }
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('contains unclassified token failures before any provider request', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGitHubClient({
      token: async () => {
        throw new Error('private vault detail harmless-secret')
      },
    })

    const error = await client.restGet('/repositories/84').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toHaveProperty('failure', { kind: 'access-unavailable' })
    expect(error instanceof Error ? error.message : '').not.toContain('private vault')
    expect(JSON.stringify(error)).not.toContain('harmless-secret')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not replay cached content while credentials fail and preserves the stable token cache after recovery', async () => {
    let unavailable = false
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: ['retained'] }, { etag: 'W/"retained"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGitHubClient({
      token: async () => {
        if (unavailable) throw new GitHubAccessError('unavailable')
        return 'harmless-stable-token'
      },
    })

    await client.restGet('/repositories/84')
    unavailable = true
    await expect(client.restGet('/repositories/84')).rejects.toMatchObject({
      failure: { kind: 'access-unavailable' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    unavailable = false
    await expect(client.restGet('/repositories/84')).resolves.toEqual({ items: ['retained'] })
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('If-None-Match')).toBe(
      'W/"retained"',
    )
  })

  it('uses current credentials for both read methods while retaining a stable token conditional cache', async () => {
    let token = 'harmless-first-token'
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: ['first-account'] }, { etag: 'W/"first"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: 'second-account' } }))
      .mockResolvedValueOnce(jsonResponse({ items: ['second-account'] }, { etag: 'W/"second"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGitHubClient({ token: async () => token })

    await expect(client.restGet('/repositories/84')).resolves.toEqual({ items: ['first-account'] })
    await expect(client.restGet('/repositories/84')).resolves.toEqual({ items: ['first-account'] })
    token = 'harmless-second-token'
    await expect(client.graphql('query {}')).resolves.toEqual({
      data: { viewer: 'second-account' },
      errors: [],
    })
    await expect(client.restGet('/repositories/84')).resolves.toEqual({ items: ['second-account'] })
    await expect(client.restGet('/repositories/84')).resolves.toEqual({ items: ['second-account'] })
    expect(
      fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get('Authorization')),
    ).toEqual([
      'Bearer harmless-first-token',
      'Bearer harmless-first-token',
      'Bearer harmless-second-token',
      'Bearer harmless-second-token',
      'Bearer harmless-second-token',
    ])
    expect(
      fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get('If-None-Match')),
    ).toEqual([null, 'W/"first"', null, null, 'W/"second"'])
  })

  it('does not install a retired token response in the current credential cache', async () => {
    let token = 'harmless-first-token'
    const oldResponse = Promise.withResolvers<Response>()
    const oldRequestStarted = Promise.withResolvers<void>()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => {
        oldRequestStarted.resolve()
        return oldResponse.promise
      })
      .mockResolvedValueOnce(jsonResponse({ items: ['current-account'] }, { etag: 'W/"current"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGitHubClient({ token: async () => token })

    const retiredRead = client.restGet('/repositories/84')
    await oldRequestStarted.promise
    token = 'harmless-second-token'
    await expect(client.restGet('/repositories/84')).resolves.toEqual({
      items: ['current-account'],
    })
    oldResponse.resolve(jsonResponse({ items: ['retired-account'] }, { etag: 'W/"retired"' }))
    await retiredRead
    await expect(client.restGet('/repositories/84')).resolves.toEqual({
      items: ['current-account'],
    })
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('If-None-Match')).toBe(
      'W/"current"',
    )
  })
})

describe('graphql', () => {
  it('sends the token and preserves validated envelope data for query-specific refinement', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: { viewer: 'a' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createGitHubClient(CONFIG).graphql('query {}', { a: 1 })

    expect(result).toEqual({ data: { viewer: 'a' }, errors: [] })
    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer t0ken')
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'query {}', variables: { a: 1 } })
  })

  it('classifies HTTP-200 execution failure without exposing provider prose as its safe cause', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ errors: [{ message: 'private repository and credential detail t0ken' }] }),
      ),
    )

    const error = await createGitHubClient(CONFIG)
      .graphql('query {}')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({ status: 200 })
    expect(error).toHaveProperty('failure', { kind: 'execution', cause: 'provider' })
    expect(error instanceof Error ? error.message : '').not.toContain('private repository')
    expect(error instanceof Error ? error.message : '').not.toContain('t0ken')
    expect(error).not.toHaveProperty('detail')
    expect(JSON.stringify(error)).not.toContain('t0ken')
  })

  it('throws on a transport failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'Bad credentials' }, { status: 401 })),
    )

    await expect(createGitHubClient(CONFIG).graphql('query {}')).rejects.toMatchObject({
      name: 'GitHubError',
      status: 401,
    })
  })

  it('classifies a network failure without exposing fetch details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket detail')
      }),
    )

    await expect(createGitHubClient(CONFIG).graphql('query {}')).rejects.toEqual(
      new GitHubError({ kind: 'transient', cause: 'network' }),
    )
  })

  it.each([
    [401, { kind: 'authorization', proof: 'http-401' }],
    [403, { kind: 'access-ambiguous', evidence: 'http-403' }],
    [404, { kind: 'access-ambiguous', evidence: 'http-404' }],
    [503, { kind: 'transient', cause: 'server' }],
  ])(
    'classifies HTTP-%s by source proof rather than treating every denial as credentials',
    async (status, failure) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse({ message: 'private t0ken provider detail' }, { status })),
      )

      const error = await createGitHubClient(CONFIG)
        .graphql('query {}')
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(GitHubError)
      expect(error).toHaveProperty('failure', failure)
      expect(error instanceof Error ? error.message : '').not.toContain('t0ken')
    },
  )

  it.each(RATE_LIMIT_RESPONSES)(
    'keeps proved rate limiting distinct from generic HTTP-$status access ambiguity',
    async ({ status, headers }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('private t0ken detail', { status, headers })),
      )

      await expect(createGitHubClient(CONFIG).graphql('query {}')).rejects.toMatchObject({
        failure: { kind: 'transient', cause: 'rate-limit' },
        status,
      })
    },
  )

  it('preserves only validated execution paths beside unknown query data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { m0: { issue: { body: 'readable prose' } }, m1: null },
          errors: [{ path: ['m1', 'issue', 0], message: 'private t0ken detail' }],
        }),
      ),
    )

    const result = await createGitHubClient(CONFIG).graphql('query {}')

    expect(result).toEqual({
      data: { m0: { issue: { body: 'readable prose' } }, m1: null },
      errors: [{ path: ['m1', 'issue', 0] }],
    })
    expect(JSON.stringify(result.errors)).not.toContain('private t0ken detail')
  })

  it.each([
    ['null envelope', null],
    ['array envelope', []],
    ['primitive data', { data: 'not an object' }],
    ['missing data', {}],
    ['malformed execution errors', { errors: [{ message: { credential: 't0ken' } }] }],
    ['non-array execution errors', { errors: { message: 't0ken' } }],
    [
      'invalid error path',
      { data: {}, errors: [{ message: 'private t0ken detail', path: [null] }] },
    ],
  ])('classifies a %s as malformed rather than returning unchecked data', async (_name, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(body)),
    )

    const error = await createGitHubClient(CONFIG)
      .graphql('query {}')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({
      status: 200,
      failure: { kind: 'read', cause: 'malformed-response' },
    })
    expect(error instanceof Error ? error.message : '').not.toContain('t0ken')
  })

  it('classifies invalid JSON as malformed without exposing its body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('private t0ken {', { status: 200 })),
    )

    const error = await createGitHubClient(CONFIG)
      .graphql('query {}')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({
      status: 200,
      failure: { kind: 'read', cause: 'malformed-response' },
    })
    expect(error instanceof Error ? error.message : '').not.toContain('t0ken')
  })

  it('classifies rejected response-body reading separately from malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('private stream detail t0ken'))
              },
            }),
          ),
      ),
    )

    const error = await createGitHubClient(CONFIG)
      .graphql('query {}')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({ status: 200, failure: { kind: 'read', cause: 'response-read' } })
    expect(error instanceof Error ? error.message : '').not.toContain('private stream')
  })
})

describe('restGet', () => {
  it('replays the cached body on a 304, which costs nothing against the rate limit', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [1] }, { etag: 'W/"abc"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createGitHubClient(CONFIG)
    const first = await client.restGet('/search/issues?q=x')
    const second = await client.restGet('/search/issues?q=x')

    expect(second).toEqual(first)
    const secondInit = fetchMock.mock.calls[1]?.[1]
    expect(new Headers(secondInit?.headers).get('If-None-Match')).toBe('W/"abc"')
  })

  it('sends no If-None-Match before anything has been cached', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await createGitHubClient(CONFIG).restGet('/search/issues?q=x')

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.has('If-None-Match')).toBe(false)
    expect(headers.get('X-GitHub-Api-Version')).toBe('2022-11-28')
  })

  it('keeps caches apart between clients', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [] }, { etag: 'W/"abc"' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createGitHubClient(CONFIG).restGet('/x')
    await createGitHubClient(CONFIG).restGet('/x')

    const secondInit = fetchMock.mock.calls[1]?.[1]
    expect(new Headers(secondInit?.headers).has('If-None-Match')).toBe(false)
  })

  it('reports a failed request as a GitHubError carrying the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'Not Found' }, { status: 404 })),
    )

    const error = await createGitHubClient(CONFIG)
      .restGet('/nope')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({ status: 404 })
  })

  it('classifies invalid REST JSON before it can enter the conditional cache', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private t0ken {', { headers: { ETag: 'W/"invalid"' } }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createGitHubClient(CONFIG)

    const error = await client.restGet('/x').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toHaveProperty('failure', { kind: 'read', cause: 'malformed-response' })
    expect(error instanceof Error ? error.message : '').not.toContain('t0ken')
    await expect(client.restGet('/x')).resolves.toEqual({ items: [] })
    const headers = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(headers.has('If-None-Match')).toBe(false)
  })

  it('classifies a REST body-read rejection without returning empty success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('private stream detail'))
              },
            }),
          ),
      ),
    )

    const error = await createGitHubClient(CONFIG)
      .restGet('/x')
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toHaveProperty('failure', { kind: 'read', cause: 'response-read' })
    expect(error instanceof Error ? error.message : '').not.toContain('private stream')
  })
})
