import type { GitHubClient, RateLimit } from './client.ts'
import type { MapRef } from './repository.ts'

/**
 * Maps fetched per GraphQL request. One aliased query pulls whole maps — sub-issues *and* every
 * blocked-by edge — so the poll costs a few points per map rather than one request per ticket.
 * See `docs/research/github-api-primitives.md` §3.
 */
const MAPS_PER_REQUEST = 10

/**
 * Connection page sizes. GitHub caps any single connection at 100 nodes.
 *
 * Measured 2026-08-07 across the three live maps: `rateLimit.cost` is 3 per map, and it tracks
 * `subIssues` alone — halving the nested pages changed nothing. So the nested pages are set
 * generously (truncating a graph silently is worse than a point) while `subIssues` stays at the
 * cap, since a map that outgrows one page loses edges rather than detail.
 */
const MAX_SUB_ISSUES = 100
const MAX_BLOCKED_BY = 50
const MAX_LABELS = 20
const MAX_ASSIGNEES = 10

export type IssueState = 'OPEN' | 'CLOSED'

export interface RawAssignee {
  login: string
  avatarUrl: string
  url: string
}

export interface RawBlocker {
  number: number
  title: string
  url: string
  state: IssueState
  repository: { nameWithOwner: string }
}

export interface RawSubIssue {
  number: number
  title: string
  url: string
  state: IssueState
  stateReason: string | null
  createdAt: string
  closedAt: string | null
  body: string
  labels: { nodes: { name: string; color: string }[] | null } | null
  assignees: { nodes: RawAssignee[] | null } | null
  blockedBy: { totalCount: number; nodes: RawBlocker[] | null } | null
}

export interface RawMapIssue {
  number: number
  title: string
  url: string
  state: IssueState
  updatedAt: string
  closedAt: string | null
  body: string
  subIssuesSummary: { total: number; completed: number; percentCompleted: number } | null
  subIssues: {
    totalCount: number
    pageInfo: { hasNextPage: boolean }
    nodes: RawSubIssue[] | null
  } | null
}

export interface RawRepository {
  nameWithOwner: string
  isPrivate: boolean
  issue: RawMapIssue | null
}

/** One map's raw GraphQL payload, paired back up with the ref that asked for it. */
export interface FetchedMap {
  ref: MapRef
  repository: RawRepository
  issue: RawMapIssue
}

export interface MapFetchResult {
  maps: FetchedMap[]
  rateLimit: RateLimit | null
  /** Refs the API returned nothing for — deleted, renamed, or no longer visible to the token. */
  missing: MapRef[]
}

const MAP_FIELDS = `
fragment MapFields on Issue {
  number
  title
  url
  state
  updatedAt
  closedAt
  body
  subIssuesSummary { total completed percentCompleted }
  subIssues(first: ${MAX_SUB_ISSUES}) {
    totalCount
    pageInfo { hasNextPage }
    nodes {
      number
      title
      url
      state
      stateReason
      createdAt
      closedAt
      body
      labels(first: ${MAX_LABELS}) { nodes { name color } }
      assignees(first: ${MAX_ASSIGNEES}) { nodes { login avatarUrl url } }
      blockedBy(first: ${MAX_BLOCKED_BY}) {
        totalCount
        nodes { number title url state repository { nameWithOwner } }
      }
    }
  }
}`

/**
 * Builds one aliased query covering `refs`. Owner, name, and number ride in as GraphQL variables
 * rather than being interpolated into the query text, so a repo name can never break the query.
 */
export function buildMapsQuery(refs: MapRef[]): {
  query: string
  variables: Record<string, unknown>
} {
  const params: string[] = []
  const blocks: string[] = []
  const variables: Record<string, unknown> = {}

  refs.forEach((ref, index) => {
    params.push(`$o${index}: String!, $n${index}: String!, $i${index}: Int!`)
    blocks.push(
      `  m${index}: repository(owner: $o${index}, name: $n${index}) {\n` +
        '    nameWithOwner\n' +
        '    isPrivate\n' +
        `    issue(number: $i${index}) { ...MapFields }\n` +
        '  }',
    )
    variables[`o${index}`] = ref.owner
    variables[`n${index}`] = ref.repo
    variables[`i${index}`] = ref.number
  })

  const query =
    `query WayfinderMaps(${params.join(', ')}) {\n` +
    `${blocks.join('\n')}\n` +
    '  rateLimit { cost remaining limit resetAt }\n' +
    `}\n${MAP_FIELDS}`

  return { query, variables }
}

type MapsQueryResponse = Record<string, RawRepository | null | undefined> & {
  rateLimit?: RateLimit | null
}

/** Splits a response back into per-ref results, dropping refs the API had nothing for. */
export function readMapsResponse(
  refs: MapRef[],
  response: MapsQueryResponse,
): Omit<MapFetchResult, 'rateLimit'> {
  const maps: FetchedMap[] = []
  const missing: MapRef[] = []

  refs.forEach((ref, index) => {
    const repository = response[`m${index}`]
    if (!repository?.issue) {
      missing.push(ref)
      return
    }
    maps.push({ ref, repository, issue: repository.issue })
  })

  return { maps, missing }
}

/** Fetches every map in `refs`, batching into as few requests as the node budget allows. */
export async function fetchMaps(client: GitHubClient, refs: MapRef[]): Promise<MapFetchResult> {
  if (refs.length === 0) return { maps: [], rateLimit: null, missing: [] }

  const batches = chunk(refs, MAPS_PER_REQUEST)
  const maps: FetchedMap[] = []
  const missing: MapRef[] = []
  let rateLimit: RateLimit | null = null
  const failures: unknown[] = []

  for (const batch of batches) {
    const { query, variables } = buildMapsQuery(batch)
    try {
      const response = await client.graphql<MapsQueryResponse>(query, variables)
      const read = readMapsResponse(batch, response)
      maps.push(...read.maps)
      missing.push(...read.missing)
      // Later batches report the budget after earlier ones spent it, so the last wins.
      if (response.rateLimit) rateLimit = response.rateLimit
    } catch (error) {
      failures.push(error)
    }
  }

  if (failures.length > 0) {
    throw failures[0] ?? new Error('A map request failed')
  }

  return { maps, rateLimit, missing }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
