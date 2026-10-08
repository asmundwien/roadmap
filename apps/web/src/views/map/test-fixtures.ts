import type {
  Blocker,
  MapBody,
  ProjectKey,
  Ticket,
  TicketState,
  TicketType,
  WayfinderMap,
} from '@roadmap/contracts'
import type { RoadmapStore, RoadmapStoreSnapshot } from '@/store/roadmap-store'

/** Map-view fixtures build snapshot-shaped maps from shorthand. */

const HOME = 'me/repo'
const HOME_PROJECT: ProjectKey = { integration: 'github', id: 'project-home' }
export function blocker(
  id: number | string,
  open: boolean = true,
  reference: Blocker['reference'] = { kind: 'registered', project: HOME_PROJECT },
): Blocker {
  const value = String(id)
  const locator =
    reference.kind === 'external'
      ? reference.nameWithOwner
      : reference.kind === 'unresolved'
        ? reference.locator
        : HOME
  return {
    reference,
    ticketId: value,
    displayId: `#${value}`,
    title: `Ticket ${value}`,
    url: `https://example.test/${locator}/${value}`,
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

function body(overrides: Partial<MapBody> = {}): MapBody {
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

export function makeRoadmapStore(): RoadmapStore {
  const snapshot: RoadmapStoreSnapshot = {
    transport: 'live',
    synchronization: 'synchronized',
    command: { inFlight: false, error: null },
    state: {
      serverEpoch: 'test',
      stateSequence: 1,
      configurationVersion: 1,
      supportedIntegrations: [],
      connections: [],
      registrations: [],
      projects: [],
      authorizationOperations: [],
      configuration: { valid: true, issues: [], notices: [] },
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        evidence: [],
        overrides: [],
      },
      roadmap: { capturedAt: 0, projects: [], unreachable: [] },
    },
  }
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    start: () => () => undefined,
    query: async () => {
      throw new Error('Unexpected query')
    },
    execute: async () => {
      throw new Error('Unexpected command')
    },
  }
}
