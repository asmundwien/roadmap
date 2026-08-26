import { describe, expect, it } from 'vitest'
import type { GitHubClient } from './client.ts'
import { listRepositoryMaps, readRepository } from './repository.ts'

function client(restGet: GitHubClient['restGet']): GitHubClient {
  return {
    restGet,
    graphql: async () => {
      throw new Error('not used')
    },
  }
}

describe('GitHub repositories', () => {
  it('reads canonical metadata by stable repository id', async () => {
    const paths: string[] = []
    const restGet: GitHubClient['restGet'] = async <T>(path: string) => {
      paths.push(path)
      return { id: 42, full_name: 'acme/renamed', private: true } as T
    }

    await expect(readRepository(client(restGet), '42')).resolves.toEqual({
      id: '42',
      nameWithOwner: 'acme/renamed',
      visibility: 'private',
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
    const restGet: GitHubClient['restGet'] = async <T>(path: string) => {
      paths.push(path)
      call += 1
      return (call === 1 ? first : [{ number: 101 }]) as T
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
})
