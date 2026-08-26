import type {
  Blocker,
  MapBody,
  Ticket,
  TicketState,
  TicketType,
  WayfinderMap,
} from '@roadmap/contracts'

/** Map-view test fixtures — the one place tests build snapshot-shaped maps from shorthand. */

export const HOME = 'me/repo'
export const HOME_PROJECT = { integration: 'github' as const, id: HOME }
export function blocker(id: number | string, open: boolean = true, projectId = HOME): Blocker {
  const value = String(id)
  return {
    project: { integration: 'github', id: projectId },
    ticketId: value,
    displayId: `#${value}`,
    title: `Ticket ${value}`,
    url: `https://example.test/${projectId}/${value}`,
    state: open ? 'open' : 'closed',
  }
}

export function ticket(
  id: number | string,
  state: TicketState,
  blockedBy: Blocker[] = [],
  closedAt?: number,
  createdAt = 0,
  type: TicketType = 'task',
): Ticket {
  const value = String(id)
  return {
    id: value,
    displayId: `#${value}`,
    title: `Ticket ${value}`,
    url: `https://example.test/${HOME}/${value}`,
    body: '',
    typeEvidence:
      type === 'untyped'
        ? { kind: 'missing', labels: [] }
        : { kind: 'recognized', value: type, labels: [type] },
    state,
    isClaimed: state === 'claimed',
    isBlocked: blockedBy.some((b) => b.state !== 'closed'),
    createdAt,
    closedAt,
    assignees: [],
    blockedBy,
    blockersComplete: true,
    warnings: [],
  }
}

export function body(overrides: Partial<MapBody> = {}): MapBody {
  return {
    raw: '',
    destination: 'The destination.',
    notes: [],
    decisions: [],
    notYetSpecified: [],
    notYetSpecifiedNote: '',
    outOfScope: [],
    sections: [],
    missingSections: [],
    ...overrides,
  }
}

export function makeMap(tickets: Ticket[], bodyOverrides: Partial<MapBody> = {}): WayfinderMap {
  return {
    project: HOME_PROJECT,
    id: '1',
    displayId: '#1',
    title: 'Test map',
    url: `https://example.test/${HOME}/1`,
    isOpen: true,
    updatedAt: 0,
    body: body(bodyOverrides),
    tickets,
    frontier: tickets.filter((t) => t.state === 'frontier'),
    progress: {
      total: tickets.length,
      completed: tickets.filter((t) => t.state === 'closed').length,
    },
    ticketsComplete: true,
    warnings: [],
  }
}
