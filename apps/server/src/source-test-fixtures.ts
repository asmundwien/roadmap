import type { Project, Ticket, WayfinderMap } from '@roadmap/contracts'
import type {
  AdapterSlice,
  ObservationAttempt,
  SourceProjectContent,
  SourceProvenance,
  SourceTicketContent,
} from './observation/source.ts'

// Public DTOs are controlled test input, never production source authority.
export function sourceFixture(projects: readonly Project[], observedAt: number): AdapterSlice {
  const attempts: ObservationAttempt[] = []
  for (const project of projects) {
    const source: SourceProjectContent['source'] =
      project.key.integration === 'local'
        ? { integration: 'local', path: project.sourcePath ?? `/tmp/${project.key.id}` }
        : {
            integration: 'github',
            repositoryId: project.key.id,
            nameWithOwner: project.name,
            url: project.sourceUrl ?? `https://github.com/${project.name}`,
          }
    const provenance: SourceProvenance =
      source.integration === 'local'
        ? { integration: 'local', path: source.path, operation: 'read' }
        : {
            integration: 'github',
            connectionId: 'github',
            repositoryId: source.repositoryId,
            stage: 'map-read',
          }
    const common = {
      kind: 'observed',
      attemptedAt: observedAt,
      observedAt,
      provenance,
      completeness: { kind: 'complete' },
    } as const
    attempts.push({
      ...common,
      scope: { kind: 'project', project: project.key },
      value: { key: project.key, name: project.name, source, warnings: project.warnings },
    })
    const maps = [...project.openMaps, ...project.closedMaps]
    attempts.push({
      ...common,
      scope: { kind: 'maps-membership', project: project.key },
      value: { members: maps.map((map) => ({ project: project.key, mapId: map.id })) },
    })
    for (const map of maps) {
      const key = { project: project.key, mapId: map.id }
      attempts.push(
        {
          ...common,
          scope: { kind: 'map', map: key },
          value: {
            key,
            displayId: map.displayId,
            title: map.title,
            source: mapSource(map),
            status: map.isOpen ? 'open' : 'closed',
            updatedAt: map.updatedAt,
            closedAt: map.closedAt,
            body: map.body,
            progress: map.progress,
            unidentifiedTickets: [],
            warnings: map.warnings,
          },
        },
        {
          ...common,
          scope: { kind: 'tickets-membership', map: key },
          completeness: map.ticketsComplete
            ? { kind: 'complete' }
            : { kind: 'incomplete', reason: 'unreadable' },
          value: { members: map.tickets.map((ticket) => ({ map: key, ticketId: ticket.id })) },
        },
      )
      for (const ticket of map.tickets) {
        const ticketKey = { map: key, ticketId: ticket.id }
        attempts.push({
          ...common,
          scope: { kind: 'ticket', ticket: ticketKey },
          value: {
            key: ticketKey,
            displayId: ticket.displayId,
            title: ticket.title,
            source: ticketSource(ticket),
            body: ticket.body,
            typeEvidence: ticket.typeEvidence,
            status: ticket.state === 'closed' ? 'closed' : 'open',
            isClaimed: ticket.isClaimed,
            createdAt: ticket.createdAt,
            closedAt: ticket.closedAt,
            assignees: ticket.assignees,
            blockedBy: ticket.blockedBy.map((blocker) => ({
              reference: { ...blocker.reference, ticketId: blocker.ticketId },
              displayId: blocker.displayId,
              title: blocker.title,
              url: blocker.url,
              state: blocker.state,
              provenance,
            })),
            blockersComplete: ticket.blockersComplete,
            warnings: ticket.warnings,
          },
        })
      }
    }
  }
  return { attempts }
}

function mapSource(
  map: WayfinderMap,
): { kind: 'file'; path: string } | { kind: 'issue'; url: string } {
  if (map.sourcePath) return { kind: 'file', path: map.sourcePath }
  if (map.url) return { kind: 'issue', url: map.url }
  throw new Error('Test map requires an explicit source destination.')
}

function ticketSource(ticket: Ticket): SourceTicketContent['source'] {
  if (ticket.sourcePath) return { kind: 'file', path: ticket.sourcePath }
  if (ticket.url) return { kind: 'issue', url: ticket.url }
  throw new Error('Test ticket requires an explicit source destination.')
}
