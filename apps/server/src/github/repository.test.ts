import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGitHubClient, type GitHubClient, GitHubError } from './client.ts'
import { listRepositoryMaps, readRepository } from './repository.ts'

function client(restGet: GitHubClient['restGet']): GitHubClient {
  return {
    restGet,
    graphql: async () => {
      throw new Error('not used')
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

describe('GitHub repositories', () => {
  it('reads canonical metadata by stable repository id', async () => {
    const paths: string[] = []
    const restGet: GitHubClient['restGet'] = async (path) => {
      paths.push(path)
      return { id: 42, full_name: 'acme/renamed', private: true }
    }

    await expect(readRepository(client(restGet), '42')).resolves.toEqual({
      id: '42',
      nameWithOwner: 'acme/renamed',
    })
    expect(paths).toEqual(['/repositories/42'])
  })

  it('lists only issues from the registered repository and paginates', async () => {
    const first: Record<string, unknown>[] = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
    }))
    first[1] = { number: 2, pull_request: {} }
    const paths: string[] = []
    let call = 0
    const restGet: GitHubClient['restGet'] = async (path) => {
      paths.push(path)
      call += 1
      return call === 1 ? first : [{ number: 101 }]
    }

    const refs = await listRepositoryMaps(client(restGet), 'acme/roadmap')

    expect(refs).toHaveLength(100)
    expect(refs[0]).toEqual({
      owner: 'acme',
      repo: 'roadmap',
      nameWithOwner: 'acme/roadmap',
      number: 1,
    })
    expect(refs.at(-1)?.number).toBe(101)
    expect(paths[0]).toContain('labels=wayfinder%3Amap')
    expect(paths[1]).toContain('page=2')
  })

  it.each([
    ['a non-array page', { items: [] }],
    ['a null item', [null]],
    ['an item without its issue identity', [{}]],
    ['an invalid issue number', [{ number: 'private detail' }]],
    ['a fractional issue number', [{ number: 1.5 }]],
    ['mixed validated and invalid items', [{ number: 1 }, { number: -2 }]],
    ['duplicate issue identities', [{ number: 1 }, { number: 1 }]],
    ['a malformed pull request marker', [{ number: 1, pull_request: null }]],
  ])('does not interpret %s as complete empty membership', async (_name, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(body)),
    )

    const error = await listRepositoryMaps(
      createGitHubClient({ token: 'fixture-token' }),
      'acme/roadmap',
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toHaveProperty('failure', { kind: 'read', cause: 'malformed-response' })
    expect(error instanceof Error ? error.message : '').not.toContain('private detail')
  })

  it('does not commit an earlier page as complete membership when a later page is malformed', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(first))
        .mockResolvedValueOnce(jsonResponse([{ number: 'private detail' }])),
    )

    const error = await listRepositoryMaps(
      createGitHubClient({ token: 'fixture-token' }),
      'acme/roadmap',
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toHaveProperty('failure', { kind: 'read', cause: 'malformed-response' })
  })

  it('classifies malformed stable repository metadata before callers can use its name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: 42, full_name: 'not/a/repository' })),
    )

    const error = await readRepository(createGitHubClient({ token: 'fixture-token' }), '42').catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toHaveProperty('failure', { kind: 'read', cause: 'malformed-response' })
  })

  it('rejects a different provider identity even when the repository name matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: 99, full_name: 'acme/roadmap' })),
    )

    const error = await readRepository(createGitHubClient({ token: 'fixture-token' }), '42').catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toHaveProperty('failure', { kind: 'identity-mismatch' })
  })
})
