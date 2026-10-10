import {
  configurationVersionSchema,
  connectionIdSchema,
  mapRefSchema,
  type ProjectRef,
  projectRefSchema,
  serverEpochSchema,
  stateSequenceSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import {
  type ApplicationState,
  applicationStateSchema,
  type Blocker,
  connectionSchema,
  type MapBody,
  type MapResource,
  type MapResourceResult,
  type Project,
  type ReadyApplicationState,
  readyApplicationStateSchema,
  type TicketResource,
  type TicketResourceResult,
  type TicketState,
  type TicketType,
} from '@roadmap/contracts/state'
import type { RoadmapStore, RoadmapStoreSnapshot } from '@/store/roadmap-store'

type TicketValue = Extract<
  TicketResourceResult,
  { kind: 'current-readable' }
>['observation']['value']
type MapValue = Extract<MapResourceResult, { kind: 'current-readable' }>['observation']['value']

const HOME = 'me/repo'
const HOME_PROJECT = projectRefSchema.parse({ integration: 'github', projectId: 'project-home' })
const HOME_MAP = mapRefSchema.parse({ project: HOME_PROJECT, mapId: '1' })

function provenance(source: TicketValue['source'], project: ProjectRef) {
  return source.kind === 'file'
    ? ({ integration: 'local', path: source.path, operation: 'read' } as const)
    : ({
        integration: 'github',
        connectionId: connectionIdSchema.parse('connection-home'),
        repositoryId: project.projectId,
        stage: 'map-read',
      } as const)
}

export function blocker(
  id: number | string,
  open: boolean = true,
  reference: Blocker['reference'] = {
    kind: 'registered',
    ticket: ticketRefSchema.parse({ map: HOME_MAP, ticketId: String(id) }),
  },
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
    ...(state === 'closed'
      ? { closedAt: closedAt ?? 0 }
      : closedAt === undefined
        ? {}
        : { closedAt }),
    assignees: [],
    blockedBy,
    blockersComplete: true,
    warnings: [],
    ...overrides,
  }
  const ref = ticketRefSchema.parse({ map: HOME_MAP, ticketId: value })
  return {
    ref,
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'ticket', ticket: ref },
        attemptedAt: 0,
        observedAt: 0,
        provenance: provenance(content.source, ref.map.project),
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
  refInput: Parameters<typeof mapRefSchema.parse>[0] = HOME_MAP,
  overrides: Partial<MapValue> = {},
): MapResource {
  const ref = mapRefSchema.parse(refInput)
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
    const scopedRef = { map: ref, ticketId: ticket.ref.ticketId }
    if (ticket.resource.kind !== 'current-readable') return ticket
    return {
      ref: scopedRef,
      resource: {
        ...ticket.resource,
        observation: {
          ...ticket.resource.observation,
          scope: { kind: 'ticket', ticket: scopedRef },
          provenance: provenance(ticket.resource.observation.value.source, ref.project),
        },
      },
    }
  })
  return {
    ref,
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'map', map: ref },
        attemptedAt: 0,
        observedAt: 0,
        provenance: provenance(content.source, ref.project),
        completeness: { kind: 'complete' },
        value: content,
      },
    },
    tickets: scopedTickets,
    frontier: scopedTickets
      .filter(
        (ticket) =>
          ticket.resource.kind === 'current-readable' &&
          ticket.resource.observation.value.status === 'open' &&
          !ticket.resource.observation.value.isClaimed &&
          ticket.resource.observation.value.blockersComplete &&
          ticket.resource.observation.value.blockedBy.every(
            (blocker) => blocker.state === 'closed',
          ),
      )
      .map((ticket) => ticket.ref),
    ticketsMembership: {
      kind: 'current-complete',
      observation: {
        scope: { kind: 'tickets-membership', map: ref },
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
            : provenance(content.source, ref.project),
        completeness: { kind: 'complete' },
        value: { members: scopedTickets.map((ticket) => ticket.ref) },
      },
    },
  }
}

export function makeApplicationState(
  projects: Project[] = [],
  overrides: Partial<ReadyApplicationState> = {},
): ReadyApplicationState {
  const connections = [
    ...new Map(
      projects.map((project) => [
        project.connectionId,
        connectionSchema.parse(
          project.integration === 'local'
            ? {
                id: project.connectionId,
                integration: 'local',
                name: 'Local files',
                builtIn: true,
                availability: { status: 'available' },
              }
            : {
                id: project.connectionId,
                integration: 'github',
                name: 'GitHub',
                builtIn: false,
                githubIdentity: { id: project.connectionId, login: 'fixture' },
                availability: { status: 'available' },
              },
        ),
      ]),
    ).values(),
  ]
  return readyApplicationStateSchema.parse({
    phase: 'ready',
    mode: 'mutable',
    capturedAt: 0,
    serverEpoch: serverEpochSchema.parse('test'),
    stateSequence: stateSequenceSchema.parse(1),
    configurationVersion: configurationVersionSchema.parse(1),
    supportedIntegrations: [],
    connections,
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
    ...overrides,
  })
}

function freezeFixture<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeFixture(child)
    Object.freeze(value)
  }
  return value
}

function lifecycle(state: ApplicationState): RoadmapStoreSnapshot['lifecycle'] {
  switch (state.phase) {
    case 'ready':
      return { phase: state.phase, mode: state.mode }
    case 'failed':
      return { phase: state.phase, cause: state.cause }
    default:
      return { phase: state.phase }
  }
}

export function makeRoadmapSnapshot(state: ApplicationState): RoadmapStoreSnapshot {
  const validatedState = applicationStateSchema.parse(state)
  if (
    validatedState.phase !== 'ready' &&
    !('retained' in validatedState && validatedState.retained !== null)
  ) {
    return freezeFixture({
      transport: 'live',
      synchronization: 'not-ready',
      lifecycle: lifecycle(validatedState),
      command: { inFlight: false, error: null },
      state: null,
    } satisfies RoadmapStoreSnapshot)
  }
  return freezeFixture({
    transport: 'live',
    synchronization: validatedState.phase === 'ready' ? 'synchronized' : 'retained',
    lifecycle: lifecycle(validatedState),
    command: { inFlight: false, error: null },
    state: validatedState,
  } satisfies RoadmapStoreSnapshot)
}

export function makeRoadmapStore(projects: Project[] = []): RoadmapStore {
  const snapshot = makeRoadmapSnapshot(makeApplicationState(projects))
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
