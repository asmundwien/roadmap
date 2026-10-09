import type {
  MapResource,
  MapResourceResult,
  ProjectKey,
  RegisteredProject,
  TicketResource,
} from '@roadmap/contracts'

export function neverReadProject(key: ProjectKey, name = key.id): RegisteredProject {
  return {
    key,
    name,
    connectionId: key.integration,
    locator:
      key.integration === 'local'
        ? { integration: 'local', path: `/tmp/${key.id}` }
        : { integration: 'github', repositoryId: key.id, nameWithOwner: `test/${key.id}` },
    workspace: { path: `/tmp/${key.id}` },
    actions: [],
    managementWarnings: [],
    resource: { kind: 'never-observed', scope: { kind: 'project', project: key }, current: null },
    mapsMembership: { kind: 'never-observed', current: null },
    maps: [],
    displayOrder: { openMapIds: [], closedMapIds: [] },
    activeMap: {
      kind: 'uncertain',
      reason: 'never-observed',
      cause: 'Active map has never been established.',
    },
  }
}

export function readableMap(
  project: ProjectKey,
  mapId: string,
  status: 'open' | 'closed' = 'open',
  updatedAt = 1_000,
): MapResource {
  const key = { project, mapId }
  const path = `/tmp/${project.id}/maps/${mapId}.md`
  return {
    key,
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
          path: `/tmp/${project.id}/tickets`,
          operation: 'enumerate',
        },
        completeness: { kind: 'complete' },
        value: { members: [] },
      },
    },
    tickets: [],
  }
}

export function readableTicket(map: MapResource, ticketId: string): TicketResource {
  const key = { map: map.key, ticketId }
  const path = `/tmp/${map.key.project.id}/tickets/${ticketId}.md`
  return {
    key,
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
          typeEvidence: { kind: 'recognized', value: 'task', labels: ['wayfinder:task'] },
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

export function currentProject(id: string, maps: MapResource[] = []): RegisteredProject {
  const project = neverReadProject({ integration: 'local', id })
  const path = `/tmp/${id}`
  const active = maps.find(
    (map) =>
      map.resource.kind === 'current-readable' && map.resource.observation.value.status === 'open',
  )
  return {
    ...project,
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'project', project: project.key },
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
        scope: { kind: 'maps-membership', project: project.key },
        attemptedAt: 1_000,
        observedAt: 1_000,
        provenance: { integration: 'local', path: `${path}/maps`, operation: 'enumerate' },
        completeness: { kind: 'complete' },
        value: { members: maps.map((map) => map.key) },
      },
    },
    displayOrder: {
      openMapIds: maps
        .filter(
          (map) =>
            map.resource.kind === 'current-readable' &&
            map.resource.observation.value.status === 'open',
        )
        .map((map) => map.key.mapId),
      closedMapIds: maps
        .filter(
          (map) =>
            map.resource.kind === 'current-readable' &&
            map.resource.observation.value.status === 'closed',
        )
        .map((map) => map.key.mapId),
    },
    activeMap: active
      ? { kind: 'known-current', mapId: active.key.mapId }
      : { kind: 'known-empty' },
  }
}

export function absentMap(map: MapResource): MapResource {
  const resource = map.resource
  const observation = resource.kind === 'current-readable' ? resource.observation : null
  const path = `/tmp/${map.key.project.id}/maps`
  const result: MapResourceResult = {
    kind: 'proven-absent',
    absence: {
      scope: { kind: 'map', map: map.key },
      attemptedAt: 2_000,
      observedAt: 2_000,
      provenance: { integration: 'local', path, operation: 'enumerate' },
      proof: {
        kind: 'complete-membership',
        parent: { kind: 'maps-membership', project: map.key.project },
      },
    },
    trace: observation
      ? { kind: 'last-successful-trace', lastSuccessful: observation }
      : { kind: 'no-known-trace' },
  }
  return { ...map, resource: result }
}
