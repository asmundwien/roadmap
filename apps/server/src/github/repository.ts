import { isRecord } from '../type-guards.ts'
import type { GitHubClient } from './client.ts'
import { GitHubError } from './client.ts'
export interface RepositoryIdentity {
  id: string
  nameWithOwner: string
}

export interface MapRef {
  owner: string
  repo: string
  nameWithOwner: string
  number: number
  repositoryId?: string
}

const PAGE_SIZE = 100

export async function readRepository(
  client: GitHubClient,
  repositoryId: string,
): Promise<RepositoryIdentity> {
  const repository = decodeRepository(
    await client.restGet(`/repositories/${encodeURIComponent(repositoryId)}`),
  )
  if (repository.id !== repositoryId) throw new GitHubError({ kind: 'identity-mismatch' })
  return repository
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
  const identities = new Set<number>()
  for (let page = 1; ; page += 1) {
    const path =
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues` +
      `?state=all&labels=${encodeURIComponent('wayfinder:map')}&per_page=${PAGE_SIZE}&page=${page}`
    const value = await client.restGet(path)
    if (!Array.isArray(value) || value.length > PAGE_SIZE) throw malformed()
    for (const ref of mapRefs(value, owner, repo, nameWithOwner)) {
      if (identities.has(ref.number)) throw malformed()
      identities.add(ref.number)
      refs.push(ref)
    }
    if (value.length < PAGE_SIZE) break
  }
  return refs.sort((a, b) => a.number - b.number)
}

function mapRefs(values: unknown[], owner: string, repo: string, nameWithOwner: string): MapRef[] {
  const refs: MapRef[] = []
  for (const candidate of values) {
    if (
      !isRecord(candidate) ||
      typeof candidate.number !== 'number' ||
      !Number.isSafeInteger(candidate.number) ||
      candidate.number <= 0
    ) {
      throw malformed()
    }
    if (candidate.pull_request !== undefined) {
      if (!isRecord(candidate.pull_request)) throw malformed()
      continue
    }
    refs.push({ owner, repo, nameWithOwner, number: candidate.number })
  }
  return refs
}

function decodeRepository(input: unknown): RepositoryIdentity {
  if (!isRecord(input)) throw malformed()
  const id = input.id
  const nameWithOwner = input.full_name
  if (
    !(
      (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
      (typeof id === 'string' && /^[1-9]\d*$/.test(id))
    ) ||
    typeof nameWithOwner !== 'string' ||
    !/^[^/\s]+\/[^/\s]+$/.test(nameWithOwner)
  ) {
    throw malformed()
  }
  return { id: String(id), nameWithOwner }
}

function malformed(): GitHubError {
  return new GitHubError({ kind: 'read', cause: 'malformed-response' })
}
