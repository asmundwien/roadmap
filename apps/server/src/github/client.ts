import type { SourceFailure } from '../observation/source.ts'
import { GitHubAccessError } from '../projects/registry.ts'
import { isRecord } from '../type-guards.ts'

const API_ROOT = 'https://api.github.com'
const REST_API_VERSION = '2022-11-28'

export interface RateLimit {
  cost: number
  remaining: number
  limit: number
  resetAt: string
}

/** Resolves the current access token for one Connection before each provider request. */
export interface GitHubAuth {
  token: string | (() => Promise<string>)
}

export class GitHubError extends Error {
  readonly failure: SourceFailure
  readonly status: number
  readonly stage: 'credentials' | 'provider'

  constructor(failure: SourceFailure, status = 0, stage: 'credentials' | 'provider' = 'provider') {
    super(`GitHub source read failed (${failure.kind}).`)
    this.name = 'GitHubError'
    this.failure = failure
    this.status = status
    this.stage = stage
  }
}

export interface GraphQLResult {
  readonly data: Record<string, unknown>
  readonly errors: readonly { readonly path: readonly (string | number)[] | null }[]
}

export interface GitHubClient {
  /** Validates the envelope, but leaves query-specific data refinement to its reader. */
  graphql(query: string, variables?: Record<string, unknown>): Promise<GraphQLResult>
  /** Replays a cached unknown body on a conditional REST 304 response. */
  restGet(path: string): Promise<unknown>
}

interface CacheEntry {
  etag: string
  body: unknown
}

interface TokenState {
  token: string
  conditionalCache: Map<string, CacheEntry>
}

export function createGitHubClient(config: GitHubAuth): GitHubClient {
  let current: TokenState | null = null

  async function resolveToken(): Promise<TokenState> {
    let token: string
    try {
      token = typeof config.token === 'string' ? config.token : await config.token()
    } catch (error) {
      throw new GitHubError(tokenFailure(error), 0, 'credentials')
    }
    if (!current || current.token !== token) {
      current = { token, conditionalCache: new Map() }
    }
    return current
  }

  function authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    }
  }

  async function request(input: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(input, init)
    } catch {
      throw new GitHubError({ kind: 'transient', cause: 'network' })
    }
  }

  async function graphql(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphQLResult> {
    const { token } = await resolveToken()
    const response = await request(`${API_ROOT}/graphql`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    if (!response.ok) throw new GitHubError(httpFailure(response), response.status)

    return parseGraphQLResult(await readJSON(response), response.status)
  }

  async function restGet(path: string): Promise<unknown> {
    const { token, conditionalCache } = await resolveToken()
    const url = path.startsWith('http') ? path : `${API_ROOT}${path}`
    const cached = conditionalCache.get(url)
    const headers: Record<string, string> = {
      ...authHeaders(token),
      'X-GitHub-Api-Version': REST_API_VERSION,
    }
    if (cached) headers['If-None-Match'] = cached.etag

    const response = await request(url, { headers })
    if (response.status === 304 && cached) return cached.body
    if (!response.ok) throw new GitHubError(httpFailure(response), response.status)

    const body = await readJSON(response)
    const etag = response.headers.get('ETag')
    if (etag) conditionalCache.set(url, { etag, body })
    return body
  }

  return { graphql, restGet }
}

function tokenFailure(error: unknown): SourceFailure {
  if (error instanceof GitHubAccessError) {
    switch (error.failure) {
      case 'network':
        return { kind: 'transient', cause: 'network' }
      case 'malformed-response':
        return { kind: 'read', cause: 'malformed-response' }
      case 'unavailable':
        return { kind: 'access-unavailable' }
      case 'authorization-required':
        return { kind: 'authorization', proof: 'authorization-required' }
      case 'rejected-credential':
        return { kind: 'authorization', proof: 'rejected-credential' }
      case 'account-mismatch':
        return { kind: 'authorization', proof: 'account-mismatch' }
    }
  }
  return { kind: 'access-unavailable' }
}

/** Refines only the transport envelope and strips provider messages from retained evidence. */
function parseGraphQLResult(envelope: unknown, status: number): GraphQLResult {
  if (!isRecord(envelope)) throw malformed(status)
  const errors = parseExecutionErrors(envelope.errors, status)
  if (isRecord(envelope.data)) return { data: envelope.data, errors }
  if (errors.length > 0 && (envelope.data === undefined || envelope.data === null)) {
    throw new GitHubError({ kind: 'execution', cause: 'provider' }, status)
  }
  throw malformed(status)
}

function parseExecutionErrors(input: unknown, status: number): GraphQLResult['errors'] {
  if (input === undefined) return []
  if (!Array.isArray(input)) throw malformed(status)
  return input.map((error) => {
    if (!isRecord(error) || typeof error.message !== 'string') throw malformed(status)
    if (error.path === undefined || error.path === null) return { path: null }
    if (!Array.isArray(error.path)) throw malformed(status)
    const path = error.path.map((segment: unknown) => {
      if (typeof segment === 'string') return segment
      if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0)
        return segment
      throw malformed(status)
    })
    return { path }
  })
}

function httpFailure(response: Response): SourceFailure {
  if (response.status === 401) return { kind: 'authorization', proof: 'http-401' }
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('X-RateLimit-Remaining') === '0' ||
        response.headers.has('Retry-After')))
  ) {
    return { kind: 'transient', cause: 'rate-limit' }
  }
  if (response.status === 403) return { kind: 'access-ambiguous', evidence: 'http-403' }
  if (response.status === 404) return { kind: 'access-ambiguous', evidence: 'http-404' }
  if (response.status >= 500) return { kind: 'transient', cause: 'server' }
  return { kind: 'execution', cause: 'provider' }
}

async function readJSON(response: Response): Promise<unknown> {
  let text: string
  try {
    text = await response.text()
  } catch {
    throw new GitHubError({ kind: 'read', cause: 'response-read' }, response.status)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw malformed(response.status)
  }
}

function malformed(status: number): GitHubError {
  return new GitHubError({ kind: 'read', cause: 'malformed-response' }, status)
}
