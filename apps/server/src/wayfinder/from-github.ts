import type { Blocker, Project, ProjectKey, Ticket, WayfinderMap } from '@roadmap/contracts'
import type { FetchedMap, RawSubIssue } from '../github/map-query.ts'
import { parseMapBody } from './map-body.ts'
import { deriveTicketState, frontierOf, ticketTypeEvidenceFromLabels } from './tickets.ts'

/** Turns one map's raw GraphQL payload into the domain object the views read. */
export function toWayfinderMap(
  fetched: FetchedMap,
  project: ProjectKey = githubProjectKey(fetched.ref.nameWithOwner),
  resolveProject: (nameWithOwner: string) => ProjectKey | undefined = githubProjectKey,
): WayfinderMap {
  const { issue } = fetched
  const rawTickets = issue.subIssues?.nodes ?? []
  const tickets = rawTickets.map((ticket) => toTicket(ticket, resolveProject))
  const summary = issue.subIssuesSummary
  return {
    project,
    id: String(issue.number),
    displayId: `#${issue.number}`,
    title: issue.title,
    url: issue.url,
    isOpen: issue.state === 'OPEN',
    updatedAt: parseTime(issue.updatedAt),
    closedAt: issue.closedAt === null ? undefined : parseTime(issue.closedAt),
    body: parseMapBody(issue.body ?? ''),
    tickets,
    frontier: frontierOf(tickets),
    progress: {
      total: summary?.total ?? tickets.length,
      completed: summary?.completed ?? tickets.filter((ticket) => ticket.state === 'closed').length,
    },
    ticketsComplete: !(issue.subIssues?.pageInfo.hasNextPage ?? false),
    warnings: [],
  }
}
function toTicket(
  raw: RawSubIssue,
  resolveProject: (nameWithOwner: string) => ProjectKey | undefined,
): Ticket {
  const labels = (raw.labels?.nodes ?? []).map((label) => label.name)
  const assignees = (raw.assignees?.nodes ?? []).map((assignee) => ({
    name: assignee.login,
    url: assignee.url,
    avatarUrl: assignee.avatarUrl,
  }))
  const blockedBy: Blocker[] = (raw.blockedBy?.nodes ?? []).map((blocker) => ({
    project:
      resolveProject(blocker.repository.nameWithOwner) ??
      githubProjectKey(blocker.repository.nameWithOwner),
    ticketId: String(blocker.number),
    displayId: `#${blocker.number}`,
    title: blocker.title,
    url: blocker.url,
    state: blocker.state === 'OPEN' ? 'open' : 'closed',
  }))

  const isOpen = raw.state === 'OPEN'
  const isClaimed = assignees.length > 0
  const hasOpenBlockers = blockedBy.some((blocker) => blocker.state !== 'closed')

  return {
    id: String(raw.number),
    displayId: `#${raw.number}`,
    title: raw.title,
    url: raw.url,
    body: raw.body ?? '',
    typeEvidence: ticketTypeEvidenceFromLabels(labels),
    state: deriveTicketState({ isOpen, isClaimed, hasOpenBlockers }),
    isClaimed,
    isBlocked: hasOpenBlockers,
    createdAt: parseTime(raw.createdAt),
    closedAt: raw.closedAt === null ? undefined : parseTime(raw.closedAt),
    assignees,
    blockedBy,
    blockersComplete: (raw.blockedBy?.totalCount ?? 0) <= blockedBy.length,
    warnings: [],
  }
}

/**
 * Groups maps by repo. A project can carry several: open ones are the live efforts, closed ones
 * the history — so they are split here rather than left to every view to re-derive.
 */
export function toProjects(fetched: readonly FetchedMap[]): Project[] {
  const projects = new Map<string, Project>()

  for (const entry of fetched) {
    const key = entry.ref.nameWithOwner
    let project = projects.get(key)
    if (!project) {
      project = {
        key: githubProjectKey(key),
        name: key,
        visibility: entry.repository.isPrivate ? 'private' : 'public',
        openMaps: [],
        closedMaps: [],
        warnings: [],
      }
      projects.set(key, project)
    }

    const map = toWayfinderMap(entry)
    if (map.isOpen) project.openMaps.push(map)
    else project.closedMaps.push(map)
  }

  // The head of openMaps is the active map; closed maps read newest stride first.
  for (const project of projects.values()) {
    project.openMaps.sort((a, b) => b.updatedAt - a.updatedAt)
    project.closedMaps.sort((a, b) => (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt))
  }

  // Projects with live efforts sort first; the rest are browsable history.
  return [...projects.values()].sort(
    (a, b) =>
      Number(b.openMaps.length > 0) - Number(a.openMaps.length > 0) || a.name.localeCompare(b.name),
  )
}

/**
 * The map a project is currently travelling — its most recently updated open map. Null means the
 * project is resting: every map closed, the trace intact. See CONTEXT.md for both terms.
 */
export function activeMapOf(project: Project): WayfinderMap | null {
  return project.openMaps[0] ?? null
}

/** GitHub timestamps are ISO 8601; an unparsable one sorts to the beginning rather than throwing. */
function parseTime(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

function githubProjectKey(nameWithOwner: string): ProjectKey {
  return { integration: 'github', id: nameWithOwner }
}
