import { isRecord } from '../type-guards.ts'
import type { GitHubClient } from './client.ts'
export interface RepositoryIdentity {
  id: string
  nameWithOwner: string
  visibility: 'public' | 'private'
}

export interface MapRef {
  owner: string
  repo: string
  nameWithOwner: string
  number: number
}

const PAGE_SIZE = 100

export async function readRepository(
  client: GitHubClient,
  repositoryId: string,
): Promise<RepositoryIdentity> {
  return decodeRepository(await client.restGet(`/repositories/${encodeURIComponent(repositoryId)}`))
}

export async function readRepositoryByName(
  client: GitHubClient,
  nameWithOwner: string,
): Promise<RepositoryIdentity> {
  const [owner, repository, extra] = nameWithOwner.split('/')
  if (!owner || !repository || extra !== undefined)
    throw new Error('Invalid GitHub repository name.')
  return decodeRepository(
    await client.restGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`),
  )
}

export async function listRepositoryMaps(
  client: GitHubClient,
  nameWithOwner: string,
): Promise<MapRef[]> {
  const [owner, repo, extra] = nameWithOwner.split('/')
  if (!owner || !repo || extra !== undefined) throw new Error('Invalid GitHub repository name.')

  const refs: MapRef[] = []
  for (let page = 1; ; page += 1) {
    const path =
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues` +
      `?state=all&labels=${encodeURIComponent('wayfinder:map')}&per_page=${PAGE_SIZE}&page=${page}`
    const value = await client.restGet<unknown>(path)
    if (!Array.isArray(value)) throw new Error('GitHub returned an invalid issue list.')
    refs.push(...mapRefs(value, owner, repo, nameWithOwner))
    if (value.length < PAGE_SIZE) break
  }
  return refs.sort((a, b) => a.number - b.number)
}

function mapRefs(values: unknown[], owner: string, repo: string, nameWithOwner: string): MapRef[] {
  const refs: MapRef[] = []
  for (const candidate of values) {
    if (!isRecord(candidate) || candidate.pull_request !== undefined) continue
    if (!Number.isInteger(candidate.number) || Number(candidate.number) <= 0) continue
    refs.push({ owner, repo, nameWithOwner, number: Number(candidate.number) })
  }
  return refs
}

function decodeRepository(input: unknown): RepositoryIdentity {
  if (!isRecord(input)) throw new Error('GitHub returned an invalid repository.')
  const id = input.id
  const nameWithOwner = input.full_name
  if (
    (typeof id !== 'number' && typeof id !== 'string') ||
    typeof nameWithOwner !== 'string' ||
    nameWithOwner.trim() === ''
  ) {
    throw new Error('GitHub returned an invalid repository.')
  }
  return {
    id: String(id),
    nameWithOwner,
    visibility: input.private === true ? 'private' : 'public',
  }
}
