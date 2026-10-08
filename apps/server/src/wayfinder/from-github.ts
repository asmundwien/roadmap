import type { FetchedMap, RawSubIssue } from '../github/map-query.ts'
import type {
  AdapterSlice,
  Completeness,
  SourceBlocker,
  SourceMapContent,
  SourceProjectKey,
  SourceProvenance,
  SourceTicketContent,
} from '../observation/source.ts'
import { observedAttempt } from '../observation/source.ts'
import { parseMapBody } from './map-body.ts'
import { ticketTypeEvidenceFromLabels } from './tickets.ts'

interface GitHubMapContext {
  readonly project: SourceProjectKey
  readonly repositoryId: string
  readonly connectionId: string
  readonly resolveProject: (
    nameWithOwner: string,
    repositoryId?: string,
  ) => SourceProjectKey | undefined
}

/** Constructs private evidence only after the provider has refined a named map response. */
export function observeGitHubMap(fetched: FetchedMap, context: GitHubMapContext): AdapterSlice {
  if (
    context.project.integration !== 'github' ||
    fetched.issue.number !== fetched.ref.number ||
    (fetched.repository.databaseId !== undefined &&
      String(fetched.repository.databaseId) !== context.repositoryId)
  ) {
    throw new Error('GitHub map identity does not match its admitted scope.')
  }
  const { issue } = fetched
  const key = { project: context.project, mapId: String(issue.number) }
  const provenance: SourceProvenance = {
    integration: 'github',
    connectionId: context.connectionId,
    repositoryId: context.repositoryId,
    stage: 'map-read',
  }
  const rawTickets = issue.subIssues?.nodes ?? []
  const parsedTickets = rawTickets.map((ticket) =>
    ticketContent(ticket, key, provenance, context.resolveProject),
  )
  const tickets = parsedTickets.map((ticket) => ticket.value)
  const membershipCompleteness = fetched.ticketsCompleteness
  const body = parseMapBody(issue.body)
  const map: SourceMapContent = {
    key,
    displayId: `#${issue.number}`,
    title: issue.title,
    source: { kind: 'issue', url: issue.url },
    status: issue.state === 'OPEN' ? 'open' : 'closed',
    updatedAt: Date.parse(issue.updatedAt),
    closedAt: issue.closedAt === null ? undefined : Date.parse(issue.closedAt),
    body,
    progress:
      issue.subIssuesSummary === null
        ? null
        : {
            total: issue.subIssuesSummary.total,
            completed: issue.subIssuesSummary.completed,
          },
    unidentifiedTickets: [],
    warnings: body.missingSections.map((section) => `Missing map section: ${section}.`),
  }
  const times = { attemptedAt: fetched.attemptedAt, observedAt: fetched.observedAt, provenance }
  return {
    attempts: [
      observedAttempt({
        kind: 'observed',
        scope: { kind: 'map', map: key },
        ...times,
        completeness:
          map.progress === null
            ? { kind: 'incomplete', reason: 'unreadable' }
            : { kind: 'complete' },
        value: map,
      }),
      observedAttempt({
        kind: 'observed',
        scope: { kind: 'tickets-membership', map: key },
        ...times,
        completeness: membershipCompleteness,
        value: { members: tickets.map((ticket) => ticket.key) },
      }),
      ...parsedTickets.map((ticket) =>
        observedAttempt({
          kind: 'observed',
          scope: { kind: 'ticket', ticket: ticket.value.key },
          ...times,
          completeness: ticket.completeness,
          value: ticket.value,
        }),
      ),
    ],
  }
}

function ticketContent(
  raw: RawSubIssue,
  map: SourceMapContent['key'],
  provenance: SourceProvenance,
  resolveProject: GitHubMapContext['resolveProject'],
) {
  const labels = (raw.labels?.nodes ?? []).map((label) => label.name)
  const assignees = (raw.assignees?.nodes ?? []).map((assignee) => ({
    name: assignee.login,
    url: assignee.url,
    avatarUrl: assignee.avatarUrl,
  }))
  const blockedBy: SourceBlocker[] = (raw.blockedBy?.nodes ?? []).map((blocker) => {
    const nameWithOwner = blocker.repository.nameWithOwner
    const repositoryId =
      blocker.repository.databaseId === undefined
        ? undefined
        : String(blocker.repository.databaseId)
    const project = resolveProject(nameWithOwner, repositoryId)
    return {
      reference: project
        ? { kind: 'registered', project, ticketId: String(blocker.number) }
        : {
            kind: 'external',
            integration: 'github',
            nameWithOwner,
            ticketId: String(blocker.number),
            ...(repositoryId === undefined ? {} : { repositoryId }),
          },
      displayId: `#${blocker.number}`,
      title: blocker.title,
      url: blocker.url,
      state: blocker.state === 'OPEN' ? 'open' : 'closed',
      provenance,
    }
  })
  const blockersComplete =
    raw.blockedBy !== null &&
    raw.blockedBy.nodes !== null &&
    raw.blockedBy.totalCount === blockedBy.length &&
    !raw.blockedBy.pageInfo.hasNextPage
  const warnings: string[] = []
  if (!blockersComplete) warnings.push('Blocker membership is incomplete.')
  if (
    raw.labels === null ||
    raw.labels.nodes === null ||
    raw.labels.pageInfo.hasNextPage ||
    raw.labels.totalCount > labels.length
  )
    warnings.push('Ticket labels are incomplete.')
  if (
    raw.assignees === null ||
    raw.assignees.nodes === null ||
    raw.assignees.pageInfo.hasNextPage ||
    raw.assignees.totalCount > assignees.length
  )
    warnings.push('Ticket assignees are incomplete.')
  const completeness: Completeness = [raw.blockedBy, raw.labels, raw.assignees].some(
    (connection) => connection === null || connection.nodes === null,
  )
    ? { kind: 'incomplete', reason: 'unreadable' }
    : warnings.length > 0
      ? { kind: 'incomplete', reason: 'pagination' }
      : { kind: 'complete' }
  const value: SourceTicketContent = {
    key: { map, ticketId: String(raw.number) },
    displayId: `#${raw.number}`,
    title: raw.title,
    source: { kind: 'issue', url: raw.url },
    body: raw.body,
    typeEvidence: ticketTypeEvidenceFromLabels(labels),
    status: raw.state === 'OPEN' ? 'open' : 'closed',
    isClaimed: assignees.length > 0,
    createdAt: Date.parse(raw.createdAt),
    closedAt: raw.closedAt === null ? undefined : Date.parse(raw.closedAt),
    assignees,
    blockedBy,
    blockersComplete,
    warnings,
  }
  return { value, completeness }
}
