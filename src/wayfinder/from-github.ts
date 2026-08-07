import type { FetchedMap, RawSubIssue } from '../github/map-query.ts'
import { parseMapBody } from './map-body.ts'
import { deriveTicketState, frontierOf, ticketTypeFromLabels } from './tickets.ts'
import type { Blocker, Project, Ticket, WayfinderMap } from './types.ts'

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

  // Projects with live efforts sort first; the rest are browsable history.
  return [...projects.values()].sort(
    (a, b) =>
      Number(b.openMaps.length > 0) - Number(a.openMaps.length > 0) ||
      a.nameWithOwner.localeCompare(b.nameWithOwner),
  )
}
