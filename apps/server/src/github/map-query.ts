import type { Completeness, SourceFailure } from '../observation/source.ts'
import { isRecord } from '../type-guards.ts'
import { type GitHubClient, GitHubError, type GraphQLResult, type RateLimit } from './client.ts'
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

export type RawSubIssue = ReturnType<typeof parseSubIssue>
export type RawMapIssue = ReturnType<typeof parseMapIssue>
type RawRepository = ReturnType<typeof parseRepository>

/** A fully refined issue, with successful read time rather than provider update time. */
export interface FetchedMap {
  ref: MapRef
  repository: RawRepository
  issue: RawMapIssue
  attemptedAt: number
  observedAt: number
  ticketsCompleteness: Completeness
}

export interface MapFetchResult {
  maps: FetchedMap[]
  failures: readonly {
    readonly ref: MapRef
    readonly failure: SourceFailure
    readonly attemptedAt: number
  }[]
  rateLimit: RateLimit | null
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
      labels(first: ${MAX_LABELS}) { totalCount pageInfo { hasNextPage } nodes { name color } }
      assignees(first: ${MAX_ASSIGNEES}) { totalCount pageInfo { hasNextPage } nodes { login avatarUrl url } }
      blockedBy(first: ${MAX_BLOCKED_BY}) {
        totalCount
        pageInfo { hasNextPage }
        nodes { number title url state repository { databaseId nameWithOwner } }
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
        '    databaseId nameWithOwner\n' +
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

/** Refines each independently named alias. Missing aliases supply explicit failure evidence. */
export function readMapsResponse(
  refs: MapRef[],
  response: unknown,
  context: {
    errors?: GraphQLResult['errors']
    attemptedAt?: number
    observedAt?: number
    now?: () => number
  } = {},
): Omit<MapFetchResult, 'rateLimit'> {
  const maps: FetchedMap[] = []
  const failures: MapFetchResult['failures'][number][] = []
  const attemptedAt = context.attemptedAt ?? (context.now ?? Date.now)()
  const errors = context.errors ?? []
  const aliases = new Set(refs.map((_, index) => `m${index}`))
  const affected = new Set<string>()
  for (const error of errors) {
    const alias = error.path?.[0]
    if (typeof alias !== 'string' || !aliases.has(alias)) {
      return {
        maps,
        failures: refs.map((ref) => ({
          ref,
          failure: { kind: 'execution', cause: 'provider' },
          attemptedAt,
        })),
      }
    }
    affected.add(alias)
  }

  refs.forEach((ref, index) => {
    const alias = `m${index}`
    try {
      if (affected.has(alias)) throw new GitHubError({ kind: 'execution', cause: 'provider' })
      const entry = readMapAlias(ref, response, alias)
      maps.push({
        ...entry,
        attemptedAt,
        observedAt: context.observedAt ?? (context.now ?? Date.now)(),
        ticketsCompleteness: connectionCompleteness(entry.issue.subIssues),
      })
    } catch (error) {
      failures.push({
        ref,
        attemptedAt,
        failure:
          error instanceof GitHubError
            ? error.failure
            : { kind: 'read', cause: 'malformed-response' },
      })
    }
  })
  return { maps, failures }
}

/** Certifies one requested identity without assigning success to any sibling alias. */
function readMapAlias(ref: MapRef, response: unknown, alias: string) {
  if (!isRecord(response)) throw malformed()
  if (!Object.hasOwn(response, alias) || response[alias] === undefined) {
    throw new GitHubError({ kind: 'access-ambiguous', evidence: 'missing-alias' })
  }
  if (response[alias] === null) {
    throw new GitHubError({ kind: 'access-ambiguous', evidence: 'null-resource' })
  }
  const repository = parseRepository(response[alias])
  if (ref.repositoryId !== undefined && repository.databaseId === undefined) throw malformed()
  if (
    repository.nameWithOwner.toLowerCase() !== ref.nameWithOwner.toLowerCase() ||
    (ref.repositoryId !== undefined && repository.databaseId !== ref.repositoryId)
  ) {
    throw new GitHubError({ kind: 'identity-mismatch' })
  }
  const issue = repository.issue
  if (issue === null) throw new GitHubError({ kind: 'access-ambiguous', evidence: 'null-resource' })
  if (issue.number !== ref.number) throw new GitHubError({ kind: 'identity-mismatch' })
  checkIssueURL(issue.url, issue.number, repository.nameWithOwner)
  return { ref, repository, issue }
}

/** Keeps successful aliases and earlier batches even when another named scope fails. */
export async function fetchMaps(
  client: GitHubClient,
  refs: MapRef[],
  now: () => number = Date.now,
): Promise<MapFetchResult> {
  const maps: FetchedMap[] = []
  const failures: MapFetchResult['failures'][number][] = []
  let rateLimit: RateLimit | null = null
  for (let offset = 0; offset < refs.length; offset += MAPS_PER_REQUEST) {
    const batch = refs.slice(offset, offset + MAPS_PER_REQUEST)
    const { query, variables } = buildMapsQuery(batch)
    const attemptedAt = now()
    try {
      const response = await client.graphql(query, variables)
      const read = readMapsResponse(batch, response.data, {
        errors: response.errors,
        attemptedAt,
        now,
      })
      maps.push(...read.maps)
      failures.push(...read.failures)
      // Budget metadata is diagnostic and cannot certify a map alias.
      const budget = parseRateLimit(response.data.rateLimit)
      if (budget) rateLimit = budget
    } catch (error) {
      const failure: SourceFailure =
        error instanceof GitHubError ? error.failure : { kind: 'transient', cause: 'network' }
      failures.push(...batch.map((ref) => ({ ref, failure, attemptedAt })))
    }
  }
  return { maps, failures, rateLimit }
}

function malformed(): GitHubError {
  return new GitHubError({ kind: 'read', cause: 'malformed-response' })
}

function record(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) throw malformed()
  return input
}

function text(input: unknown): string {
  if (typeof input !== 'string') throw malformed()
  return input
}

function count(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) throw malformed()
  return input
}

function issueNumber(input: unknown): number {
  const number = count(input)
  if (number === 0) throw malformed()
  return number
}

function state(input: unknown): 'OPEN' | 'CLOSED' {
  if (input !== 'OPEN' && input !== 'CLOSED') throw malformed()
  return input
}

function time(input: unknown): string {
  const value = text(input)
  if (!Number.isFinite(Date.parse(value))) throw malformed()
  return value
}

function nullableTime(input: unknown): string | null {
  return input === null ? null : time(input)
}

function repositoryName(input: unknown): string {
  const value = text(input)
  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) throw malformed()
  return value
}

function databaseId(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined
  if (
    (typeof input === 'number' && Number.isSafeInteger(input) && input > 0) ||
    (typeof input === 'string' && /^[1-9]\d*$/.test(input))
  ) {
    return String(input)
  }
  throw malformed()
}

function checkIssueURL(input: string, number: number, nameWithOwner?: string): void {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw malformed()
  }
  const match = /^\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)$/.exec(url.pathname)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username !== '' ||
    url.password !== '' ||
    !match ||
    match[2] !== String(number) ||
    (nameWithOwner !== undefined && match[1]?.toLowerCase() !== nameWithOwner.toLowerCase())
  ) {
    throw new GitHubError({ kind: 'identity-mismatch' })
  }
}

function parseConnection<T>(input: unknown, parseNode: (input: unknown) => T) {
  if (input === null) return null
  const value = record(input)
  const totalCount = count(value.totalCount)
  const page = record(value.pageInfo)
  if (typeof page.hasNextPage !== 'boolean') throw malformed()
  if (value.nodes !== null && !Array.isArray(value.nodes)) throw malformed()
  const nodes = value.nodes === null ? null : value.nodes.map(parseNode)
  if (nodes !== null && nodes.length > totalCount) throw malformed()
  return { totalCount, pageInfo: { hasNextPage: page.hasNextPage }, nodes }
}

function connectionCompleteness(
  connection: {
    totalCount: number
    pageInfo: { hasNextPage: boolean }
    nodes: readonly unknown[] | null
  } | null,
): Completeness {
  if (connection === null || connection.nodes === null)
    return { kind: 'incomplete', reason: 'unreadable' }
  if (connection.pageInfo.hasNextPage || connection.nodes.length < connection.totalCount) {
    return { kind: 'incomplete', reason: 'pagination' }
  }
  return { kind: 'complete' }
}

function parseLabel(input: unknown) {
  const value = record(input)
  return { name: text(value.name), color: text(value.color) }
}

function parseAssignee(input: unknown) {
  const value = record(input)
  return { login: text(value.login), avatarUrl: text(value.avatarUrl), url: text(value.url) }
}

function parseBlocker(input: unknown) {
  const value = record(input)
  const repository = record(value.repository)
  const nameWithOwner = repositoryName(repository.nameWithOwner)
  const id = databaseId(repository.databaseId)
  const number = issueNumber(value.number)
  const url = text(value.url)
  checkIssueURL(url, number, nameWithOwner)
  return {
    number,
    title: text(value.title),
    url,
    state: state(value.state),
    repository: { nameWithOwner, ...(id === undefined ? {} : { databaseId: id }) },
  }
}

function parseSubIssue(input: unknown) {
  const value = record(input)
  const number = issueNumber(value.number)
  const url = text(value.url)
  checkIssueURL(url, number)
  return {
    number,
    title: text(value.title),
    url,
    state: state(value.state),
    stateReason: value.stateReason === null ? null : text(value.stateReason),
    createdAt: time(value.createdAt),
    closedAt: nullableTime(value.closedAt),
    body: text(value.body),
    labels: parseConnection(value.labels, parseLabel),
    assignees: parseConnection(value.assignees, parseAssignee),
    blockedBy: parseConnection(value.blockedBy, parseBlocker),
  }
}

function parseSummary(input: unknown) {
  if (input === null) return null
  const value = record(input)
  const total = count(value.total)
  const completed = count(value.completed)
  if (
    completed > total ||
    typeof value.percentCompleted !== 'number' ||
    !Number.isFinite(value.percentCompleted) ||
    value.percentCompleted < 0 ||
    value.percentCompleted > 100
  ) {
    throw malformed()
  }
  return { total, completed, percentCompleted: value.percentCompleted }
}

function parseMapIssue(input: unknown) {
  const value = record(input)
  const subIssues = parseConnection(value.subIssues, parseSubIssue)
  if (subIssues !== null && subIssues.nodes !== null) {
    const identities = new Set<number>()
    for (const issue of subIssues.nodes) {
      if (identities.has(issue.number)) throw malformed()
      identities.add(issue.number)
    }
  }
  return {
    number: issueNumber(value.number),
    title: text(value.title),
    url: text(value.url),
    state: state(value.state),
    updatedAt: time(value.updatedAt),
    closedAt: nullableTime(value.closedAt),
    body: text(value.body),
    subIssuesSummary: parseSummary(value.subIssuesSummary),
    subIssues,
  }
}

function parseRepository(input: unknown) {
  const value = record(input)
  const id = databaseId(value.databaseId)
  return {
    nameWithOwner: repositoryName(value.nameWithOwner),
    ...(id === undefined ? {} : { databaseId: id }),
    issue: value.issue === null ? null : parseMapIssue(value.issue),
  }
}

function parseRateLimit(input: unknown): RateLimit | null {
  if (input === null || input === undefined) return null
  try {
    const value = record(input)
    const cost = count(value.cost)
    const remaining = count(value.remaining)
    const limit = count(value.limit)
    if (remaining > limit) return null
    return { cost, remaining, limit, resetAt: time(value.resetAt) }
  } catch {
    return null
  }
}
