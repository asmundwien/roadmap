import { describe, expect, it, vi } from 'vitest'
import type { GitHubClient } from './client.ts'
import { discoverMaps } from './discovery.ts'

function clientReturning(items: { number: number; repository_url: string }[]) {
  const restGet = vi.fn<(path: string) => Promise<unknown>>(async () => ({
    total_count: items.length,
    incomplete_results: false,
    items,
  }))
  const client: GitHubClient = { graphql: vi.fn(), restGet: restGet as GitHubClient['restGet'] }
  return { client, restGet }
}

describe('discoverMaps', () => {
  it('quotes the label and scopes to issues, as advanced search requires', async () => {
    const { client, restGet } = clientReturning([])

    await discoverMaps(client, 'asmundwien')

    const path = String(restGet.mock.calls[0]?.[0])
    expect(decodeURIComponent(path)).toContain('label:"wayfinder:map" user:asmundwien is:issue')
    expect(path).toContain('per_page=100')
  })

  it('reads owner and repo out of the repository_url search returns', async () => {
    const { client } = clientReturning([
      { number: 1, repository_url: 'https://api.github.com/repos/asmundwien/roadmap' },
    ])

    expect(await discoverMaps(client, 'asmundwien')).toEqual([
      { owner: 'asmundwien', repo: 'roadmap', nameWithOwner: 'asmundwien/roadmap', number: 1 },
    ])
  })

  it('returns a stable order, since search orders by relevance', async () => {
    const { client } = clientReturning([
      { number: 4, repository_url: 'https://api.github.com/repos/a/starmap' },
      { number: 1, repository_url: 'https://api.github.com/repos/a/gainstage' },
      { number: 1, repository_url: 'https://api.github.com/repos/a/starmap' },
    ])

    expect(
      (await discoverMaps(client, 'a')).map((ref) => `${ref.nameWithOwner}#${ref.number}`),
    ).toEqual(['a/gainstage#1', 'a/starmap#1', 'a/starmap#4'])
  })

  it('skips an item whose repository_url it cannot read', async () => {
    const { client } = clientReturning([
      { number: 1, repository_url: 'nonsense' },
      { number: 2, repository_url: 'https://api.github.com/repos/a/r' },
    ])

    expect(await discoverMaps(client, 'a')).toHaveLength(1)
  })
})
