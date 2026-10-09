import type {
  Blocker,
  MapBody,
  MapResource,
  MapResourceResult,
  ProjectKey,
  RegisteredProject,
  TicketResource,
  TicketResourceResult,
  TicketState,
  TicketType,
} from '@roadmap/contracts'
import type { RoadmapStore, RoadmapStoreSnapshot } from '@/store/roadmap-store'

type TicketValue = Extract<
  TicketResourceResult,
  { kind: 'current-readable' }
>['observation']['value']
type MapValue = Extract<MapResourceResult, { kind: 'current-readable' }>['observation']['value']

const HOME = 'me/repo'
const HOME_PROJECT: ProjectKey = { integration: 'github', id: 'project-home' }
const HOME_MAP: MapResource['key'] = { project: HOME_PROJECT, mapId: '1' }

function provenance(source: TicketValue['source'], project: ProjectKey) {
  return source.kind === 'file'
    ? ({ integration: 'local', path: source.path, operation: 'read' } as const)
    : ({
        integration: 'github',
        connectionId: 'connection-home',
        repositoryId: project.id,
        stage: 'map-read',
      } as const)
}

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
  overrides: Partial<TicketValue> = {},
): TicketResource {
  const value = String(id)
  const content: TicketValue = {
    displayId: `#${value}`,
    title: `Ticket ${value}`,
    source: { kind: 'issue', url: `https://example.test/${HOME}/${value}` },
    status: state === 'closed' ? 'closed' : 'open',
    body: '',
    typeEvidence:
      type === 'untyped'
        ? { kind: 'missing', labels: [] }
        : { kind: 'recognized', value: type, labels: [type] },
    state,
    isClaimed: state === 'claimed',
    isBlocked: blockedBy.some((blocker) => blocker.state !== 'closed'),
    createdAt,
    ...(closedAt === undefined ? {} : { closedAt }),
    assignees: [],
    blockedBy,
    blockersComplete: true,
    warnings: [],
    ...overrides,
  }
  const key = { map: HOME_MAP, ticketId: value }
  return {
    key,
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'ticket', ticket: key },
        attemptedAt: 0,
        observedAt: 0,
        provenance: provenance(content.source, key.map.project),
        completeness: { kind: 'complete' },
        value: content,
      },
    },
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

export function makeMap(
  tickets: TicketResource[],
  bodyOverrides: Partial<MapBody> = {},
  key: MapResource['key'] = HOME_MAP,
  overrides: Partial<MapValue> = {},
): MapResource {
  const content: MapValue = {
    displayId: '#1',
    title: 'Test map',
    source: { kind: 'issue', url: `https://example.test/${HOME}/1` },
    status: 'open',
    updatedAt: 0,
    body: body(bodyOverrides),
    progress: {
      total: tickets.length,
      completed: tickets.filter(
        (ticket) =>
          ticket.resource.kind === 'current-readable' &&
          ticket.resource.observation.value.state === 'closed',
      ).length,
    },
    warnings: [],
    ...overrides,
  }
  const scopedTickets = tickets.map((ticket): TicketResource => {
    const scopedKey = { map: key, ticketId: ticket.key.ticketId }
    if (ticket.resource.kind !== 'current-readable') return ticket
    return {
      key: scopedKey,
      resource: {
        ...ticket.resource,
        observation: {
          ...ticket.resource.observation,
          scope: { kind: 'ticket', ticket: scopedKey },
          provenance: provenance(ticket.resource.observation.value.source, key.project),
        },
      },
    }
  })
  return {
    key,
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'map', map: key },
        attemptedAt: 0,
        observedAt: 0,
        provenance: provenance(content.source, key.project),
        completeness: { kind: 'complete' },
        value: content,
      },
    },
    tickets: scopedTickets,
    ticketsMembership: {
      kind: 'current-complete',
      observation: {
        scope: { kind: 'tickets-membership', map: key },
        attemptedAt: 0,
        observedAt: 0,
        provenance:
          content.source.kind === 'file'
            ? {
                integration: 'local',
                path:
                  content.source.path.substring(0, content.source.path.lastIndexOf('/')) +
                  '/tickets',
                operation: 'enumerate',
              }
            : provenance(content.source, key.project),
        completeness: { kind: 'complete' },
        value: { members: scopedTickets.map((ticket) => ticket.key) },
      },
    },
  }
}

export function makeRoadmapStore(projects: RegisteredProject[] = []): RoadmapStore {
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
      projects,
      authorizationOperations: [],
      configuration: { valid: true, issues: [], notices: [] },
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        evidence: [],
        overrides: [],
      },
      roadmap: { capturedAt: 0 },
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
