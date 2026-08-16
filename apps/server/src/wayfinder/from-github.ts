import type { Blocker, Project, Ticket, WayfinderMap } from '@roadmap/contracts'
import type { FetchedMap, RawSubIssue } from '../github/map-query.ts'
import { parseMapBody } from './map-body.ts'
import { deriveTicketState, frontierOf, ticketTypeFromLabels } from './tickets.ts'

/** Turns one map's raw GraphQL payload into the domain object the views read. */
export function toWayfinderMap(fetched: FetchedMap): WayfinderMap {
  const { ref, issue } = fetched
  const rawTickets = issue.subIssues?.nodes ?? []
  const tickets = rawTickets.map(toTicket)
  const summary = issue.subIssuesSummary

  return {
    owner: ref.owner,
    repo: ref.repo,
    nameWithOwner: ref.nameWithOwner,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    isOpen: issue.state === 'OPEN',
    updatedAt: parseTime(issue.updatedAt),
    closedAt: issue.closedAt === null ? null : parseTime(issue.closedAt),
    body: parseMapBody(issue.body ?? ''),
    tickets,
    frontier: frontierOf(tickets),
    progress: {
      total: summary?.total ?? tickets.length,
      completed: summary?.completed ?? tickets.filter((t) => t.state === 'closed').length,
      percentCompleted: summary?.percentCompleted ?? 0,
    },
    ticketsTruncated: issue.subIssues?.pageInfo.hasNextPage ?? false,
  }
}

function toTicket(raw: RawSubIssue): Ticket {
  const labels = (raw.labels?.nodes ?? []).map((label) => label.name)
  const assignees = raw.assignees?.nodes ?? []
  const blockedBy: Blocker[] = (raw.blockedBy?.nodes ?? []).map((blocker) => ({
    number: blocker.number,
    title: blocker.title,
    url: blocker.url,
    nameWithOwner: blocker.repository.nameWithOwner,
    isOpen: blocker.state === 'OPEN',
  }))

  const isOpen = raw.state === 'OPEN'
  const isClaimed = assignees.length > 0
  const hasOpenBlockers = blockedBy.some((blocker) => blocker.isOpen)

  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    type: ticketTypeFromLabels(labels),
    state: deriveTicketState({ isOpen, isClaimed, hasOpenBlockers }),
    isClaimed,
    isBlocked: hasOpenBlockers,
    createdAt: parseTime(raw.createdAt),
    closedAt: raw.closedAt === null ? null : parseTime(raw.closedAt),
    assignees,
    blockedBy,
    blockersTruncated: (raw.blockedBy?.totalCount ?? 0) > blockedBy.length,
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
        nameWithOwner: key,
        owner: entry.ref.owner,
        repo: entry.ref.repo,
        isPrivate: entry.repository.isPrivate,
        openMaps: [],
        closedMaps: [],
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
      Number(b.openMaps.length > 0) - Number(a.openMaps.length > 0) ||
      a.nameWithOwner.localeCompare(b.nameWithOwner),
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
