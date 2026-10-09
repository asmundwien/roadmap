import {
  connectionIdSchema,
  githubProjectRefSchema,
  localProjectRefSchema,
  mapRefSchema,
  type ProjectRef,
  projectRefSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import type {
  MapResource,
  MapResourceResult,
  Project,
  TicketResource,
} from '@roadmap/contracts/state'

export function neverReadProject(
  input: Parameters<typeof projectRefSchema.parse>[0],
  name?: string,
): Project {
  const ref = projectRefSchema.parse(input)
  const common = {
    name: name ?? ref.projectId,
    connectionId: connectionIdSchema.parse(ref.integration),
    actions: [],
    managementWarnings: [],
    resource: { kind: 'never-observed', scope: { kind: 'project', project: ref }, current: null },
    mapsMembership: { kind: 'never-observed', current: null },
    maps: [],
    displayOrder: { open: [], closed: [] },
    activeMap: {
      kind: 'uncertain',
      reason: 'never-observed',
      cause: 'Active map has never been established.',
    },
  } as const
  return ref.integration === 'local'
    ? {
        ...common,
        actions: [],
        managementWarnings: [],
        maps: [],
        displayOrder: { open: [], closed: [] },
        integration: 'local',
        ref: localProjectRefSchema.parse(ref),
        source: { integration: 'local', path: `/tmp/${ref.projectId}` },
        management: {},
      }
    : {
        ...common,
        actions: [],
        managementWarnings: [],
        maps: [],
        displayOrder: { open: [], closed: [] },
        integration: 'github',
        ref: githubProjectRefSchema.parse(ref),
        source: {
          integration: 'github',
          repositoryId: ref.projectId,
          nameWithOwner: `test/${ref.projectId}`,
          url: `https://example.test/test/${ref.projectId}`,
        },
        management: { workspacePath: `/tmp/${ref.projectId}` },
      }
}

export function readableMap(
  project: ProjectRef,
  mapId: string,
  status: 'open' | 'closed' = 'open',
  updatedAt = 1_000,
): MapResource {
  const key = mapRefSchema.parse({ project, mapId })
  const path = `/tmp/${project.projectId}/maps/${mapId}.md`
  return {
    ref: key,
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'map', map: key },
        attemptedAt: updatedAt,
        observedAt: updatedAt,
        provenance: { integration: 'local', path, operation: 'read' },
        completeness: { kind: 'complete' },
        value: {
          title: `Map ${mapId}`,
          source: { kind: 'file', path },
          status,
          updatedAt,
          ...(status === 'closed' ? { closedAt: updatedAt } : {}),
          body: {
            raw: '',
            destination: `**Destination ${mapId}**`,
            notes: [],
            decisions: [],
            notYetSpecified: status === 'open' ? ['Unknown territory'] : [],
            notYetSpecifiedNote: '',
            outOfScope: [],
            sections: [],
            missingSections: [],
          },
          progress: { total: 4, completed: 3 },
          warnings: [],
        },
      },
    },
    ticketsMembership: {
      kind: 'current-complete',
      observation: {
        scope: { kind: 'tickets-membership', map: key },
        attemptedAt: updatedAt,
        observedAt: updatedAt,
        provenance: {
          integration: 'local',
          path: `/tmp/${project.projectId}/tickets`,
          operation: 'enumerate',
        },
        completeness: { kind: 'complete' },
        value: { members: [] },
      },
    },
    tickets: [],
    frontier: [],
  }
}

export function readableTicket(map: MapResource, ticketId: string): TicketResource {
  const key = ticketRefSchema.parse({ map: map.ref, ticketId })
  const path = `/tmp/${map.ref.project.projectId}/tickets/${ticketId}.md`
  return {
    ref: key,
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'ticket', ticket: key },
        attemptedAt: 1_000,
        observedAt: 1_000,
        provenance: { integration: 'local', path, operation: 'read' },
        completeness: { kind: 'complete' },
        value: {
          source: { kind: 'file', path },
          status: 'open',
          body: '',
          typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
          state: 'frontier',
          isClaimed: false,
          isBlocked: false,
          assignees: [],
          blockedBy: [],
          blockersComplete: true,
          warnings: [],
        },
      },
    },
  }
}

export function currentProject(id: string, maps: MapResource[] = [], path = `/tmp/${id}`): Project {
  const project = neverReadProject({ integration: 'local', projectId: id })
  const active = maps.find(
    (map) =>
      map.resource.kind === 'current-readable' && map.resource.observation.value.status === 'open',
  )
  const currentMaps = maps.filter((map) => map.resource.kind !== 'proven-absent')
  const unavailable = currentMaps.some((map) => map.resource.kind !== 'current-readable')
  const incomplete = currentMaps.some(
    (map) =>
      map.resource.kind === 'current-readable' &&
      (map.resource.observation.completeness.kind !== 'complete' ||
        map.resource.observation.value.progress === null ||
        map.ticketsMembership.kind !== 'current-complete'),
  )
  return {
    ...project,
    integration: 'local',
    ref: localProjectRefSchema.parse(project.ref),
    source: { integration: 'local', path },
    management: {},
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'project', project: project.ref },
        attemptedAt: 1_000,
        observedAt: 1_000,
        provenance: { integration: 'local', path, operation: 'inspect-root' },
        completeness: { kind: 'complete' },
        value: { name: id, source: { integration: 'local', path }, warnings: [] },
      },
    },
    maps,
    mapsMembership: {
      kind: 'current-complete',
      observation: {
        scope: { kind: 'maps-membership', project: project.ref },
        attemptedAt: 1_000,
        observedAt: 1_000,
        provenance: { integration: 'local', path: `${path}/maps`, operation: 'enumerate' },
        completeness: { kind: 'complete' },
        value: { members: currentMaps.map((map) => map.ref) },
      },
    },
    displayOrder: {
      open: maps
        .filter(
          (map) =>
            map.resource.kind === 'current-readable' &&
            map.resource.observation.value.status === 'open',
        )
        .map((map) => map.ref),
      closed: maps
        .filter(
          (map) =>
            map.resource.kind === 'current-readable' &&
            map.resource.observation.value.status === 'closed',
        )
        .map((map) => map.ref),
    },
    activeMap: unavailable
      ? {
          kind: 'uncertain',
          reason: 'map-unavailable',
          cause: 'A map required for ordering is currently unavailable.',
        }
      : incomplete
        ? {
            kind: 'uncertain',
            reason: 'map-incomplete',
            cause: 'A map required for ordering is incomplete.',
          }
        : active
          ? { kind: 'known-current', ref: active.ref }
          : { kind: 'known-empty' },
  }
}

export function absentMap(map: MapResource): MapResource {
  const resource = map.resource
  const observation = resource.kind === 'current-readable' ? resource.observation : null
  const path = `/tmp/${map.ref.project.projectId}/maps`
  const result: MapResourceResult = {
    kind: 'proven-absent',
    absence: {
      scope: { kind: 'map', map: map.ref },
      attemptedAt: 2_000,
      observedAt: 2_000,
      provenance: { integration: 'local', path, operation: 'enumerate' },
      proof: {
        kind: 'complete-membership',
        parent: { kind: 'maps-membership', project: map.ref.project },
      },
    },
    trace: observation
      ? { kind: 'last-successful-trace', lastSuccessful: observation }
      : { kind: 'no-known-trace' },
  }
  return { ...map, resource: result }
}
