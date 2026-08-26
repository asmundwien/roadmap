import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGitHubClient, GitHubError } from './client.ts'

const CONFIG = { token: 't0ken', user: 'asmundwien' }

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers()
  if (init.etag) headers.set('ETag', init.etag)
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('graphql', () => {
  it('sends the token and returns the data', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ data: { viewer: 'a' } }))
    vi.stubGlobal('fetch', fetchMock)

    const data = await createGitHubClient(CONFIG).graphql<{ viewer: string }>('query {}', { a: 1 })

    expect(data).toEqual({ viewer: 'a' })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer t0ken')
    expect(JSON.parse(String(init.body))).toEqual({ query: 'query {}', variables: { a: 1 } })
  })

  it('throws on an errors payload, which GraphQL sends with a 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ errors: [{ message: "Field 'x' doesn't exist" }] })),
    )

    await expect(createGitHubClient(CONFIG).graphql('query {}')).rejects.toThrow(
      "Field 'x' doesn't exist",
    )
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
      new GitHubError('GitHub could not be reached.', 0),
    )
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
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect((secondInit.headers as Record<string, string>)['If-None-Match']).toBe('W/"abc"')
  })

  it('sends no If-None-Match before anything has been cached', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await createGitHubClient(CONFIG).restGet('/search/issues?q=x')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['If-None-Match']).toBeUndefined()
    expect((init.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2022-11-28')
  })

  it('keeps caches apart between clients', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [] }, { etag: 'W/"abc"' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createGitHubClient(CONFIG).restGet('/x')
    await createGitHubClient(CONFIG).restGet('/x')

    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect((secondInit.headers as Record<string, string>)['If-None-Match']).toBeUndefined()
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
})
