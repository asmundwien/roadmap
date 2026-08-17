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

export function blocker(number: number, isOpen = true, nameWithOwner = HOME): Blocker {
  return {
    number,
    title: `Ticket ${number}`,
    url: `https://example.test/${nameWithOwner}/${number}`,
    nameWithOwner,
    isOpen,
  }
}

export function ticket(
  number: number,
  state: TicketState,
  blockedBy: Blocker[] = [],
  closedAt: number | null = null,
  createdAt = 0,
  type: TicketType = 'task',
): Ticket {
  return {
    number,
    title: `Ticket ${number}`,
    url: `https://example.test/${HOME}/${number}`,
    body: '',
    type,
    state,
    isClaimed: state === 'claimed',
    isBlocked: blockedBy.some((b) => b.isOpen),
    createdAt,
    closedAt,
    assignees: [],
    blockedBy,
    blockersTruncated: false,
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
    owner: 'me',
    repo: 'repo',
    nameWithOwner: HOME,
    number: 1,
    title: 'Test map',
    url: `https://example.test/${HOME}/1`,
    isOpen: true,
    updatedAt: 0,
    closedAt: null,
    body: body(bodyOverrides),
    tickets,
    frontier: tickets.filter((t) => t.state === 'frontier'),
    progress: {
      total: tickets.length,
      completed: tickets.filter((t) => t.state === 'closed').length,
      percentCompleted: 0,
    },
    ticketsTruncated: false,
  }
}
