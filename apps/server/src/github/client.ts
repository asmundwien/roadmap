import type { RateLimit } from '@roadmap/contracts'

const API_ROOT = 'https://api.github.com'
const REST_API_VERSION = '2022-11-28'

// The budget shape now lives in contracts — it rides inside every snapshot — but the client's
// consumers keep importing it from here, so the transport stays self-contained.
export type { RateLimit }

/** All the client needs: the PAT. Reads stay on the PAT; the App's secret never touches here. */
export interface GitHubAuth {
  token: string
}

export class GitHubError extends Error {
  status: number
  detail: string | null

  constructor(message: string, status: number, detail: string | null = null) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.detail = detail
  }
}

export interface GitHubClient {
  /** POSTs a GraphQL query. Throws `GitHubError` on transport errors *and* on `errors` payloads. */
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>
  /**
   * GETs a REST path, transparently replaying the cached body on a 304. Conditional requests that
   * return 304 cost nothing against the REST pool.
   */
  restGet<T>(path: string): Promise<T>
}

interface GraphQLEnvelope<T> {
  data?: T
  errors?: { message: string }[]
}

interface CacheEntry {
  etag: string
  body: unknown
}

export function createGitHubClient(config: GitHubAuth): GitHubClient {
  // Per-client so two clients never share a cache, and so tests start clean.
  const conditionalCache = new Map<string, CacheEntry>()

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
    }
  }

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${API_ROOT}/graphql`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new GitHubError(
        `GraphQL request failed (${response.status})`,
        response.status,
        await readErrorDetail(response),
      )
    }

    // GraphQL reports query-level failures as 200 + `errors`, so status alone proves nothing.
    const envelope = (await response.json()) as GraphQLEnvelope<T>
    if (envelope.errors && envelope.errors.length > 0) {
      const messages = envelope.errors.map((error) => error.message).join('; ')
      throw new GitHubError(`GraphQL error: ${messages}`, 200, messages)
    }
    if (!envelope.data) {
      throw new GitHubError('GraphQL response carried no data', 200)
    }
    return envelope.data
  }

  async function restGet<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${API_ROOT}${path}`
    const cached = conditionalCache.get(url)
    const headers: Record<string, string> = {
      ...authHeaders(),
      'X-GitHub-Api-Version': REST_API_VERSION,
    }
    if (cached) headers['If-None-Match'] = cached.etag

    const response = await fetch(url, { headers })

    if (response.status === 304 && cached) return cached.body as T

    if (!response.ok) {
      throw new GitHubError(
        `GET ${path} failed (${response.status})`,
        response.status,
        await readErrorDetail(response),
      )
    }

    const body = (await response.json()) as T
    const etag = response.headers.get('ETag')
    if (etag) conditionalCache.set(url, { etag, body })
    return body
  }

  return { graphql, restGet }
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text()
    return text === '' ? null : text.slice(0, 500)
  } catch {
    return null
  }
}
