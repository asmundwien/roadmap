import type { MapRef } from '@roadmap/contracts'
import type { GitHubClient } from './client.ts'

// `MapRef` moved to contracts (it rides inside snapshots as `unreachable`); re-exported so the
// rest of the data layer keeps importing it from the module that produces refs.
export type { MapRef }

interface SearchResponse {
  total_count: number
  incomplete_results: boolean
  items: SearchItem[]
}

interface SearchItem {
  number: number
  /** e.g. `https://api.github.com/repos/asmundwien/roadmap` — the only repo id search returns. */
  repository_url: string
}

/**
 * Every `wayfinder:map` issue the token can see across the account, open and closed alike.
 *
 * Uses REST search rather than GraphQL deliberately: search has its own 30/min rate pool, so
 * discovery never eats into the GraphQL points the fast map poll spends. `is:issue` is required
 * under advanced search, and the label is quoted because of its colon —
 * see `docs/research/github-api-primitives.md` §1.
 */
export async function discoverMaps(client: GitHubClient, user: string): Promise<MapRef[]> {
  const query = `label:"wayfinder:map" user:${user} is:issue`
  const path = `/search/issues?q=${encodeURIComponent(query)}&per_page=100`

  const response = await client.restGet<SearchResponse>(path)

  const refs: MapRef[] = []
  for (const item of response.items) {
    const ref = toMapRef(item)
    if (ref) refs.push(ref)
  }

  // Search orders by relevance; the views want a stable order across polls.
  return refs.sort((a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner) || a.number - b.number)
}

function toMapRef(item: SearchItem): MapRef | null {
  const parts = item.repository_url.split('/')
  const repo = parts[parts.length - 1]
  const owner = parts[parts.length - 2]
  if (!owner || !repo) return null
  return { owner, repo, nameWithOwner: `${owner}/${repo}`, number: item.number }
}
