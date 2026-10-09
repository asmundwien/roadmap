import {
  connectionIdSchema,
  mapRefSchema,
  type ProjectRef,
  projectRefSchema,
  type TicketRef,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import {
  type Connection,
  type ConnectionAvailability,
  type ReadyApplicationState,
  readyApplicationStateSchema,
  type SupportedIntegration,
} from '@roadmap/contracts/state'
import type { AuthorizationFact } from '../authorization/contracts.ts'
import type { AutomationEvidence, AutomationOverrideControl } from '../automation/model.ts'
import type { CommittedObservation } from '../observation/coordinator.ts'
import type {
  AbsentAttempt,
  ObservationAttempt,
  SourceBlocker,
  SourceMapContent,
  SourceMapKey,
  SourceProjectKey,
  SourceScope,
  SourceTicketContent,
  SourceTicketKey,
} from '../observation/source.ts'
import type {
  ConfiguredConnection,
  ProjectAdmissionRecord,
  ProjectConfiguration,
  ProjectConfigurationIntent,
} from '../projects/registry.ts'
import type {
  CatalogMap,
  MapResourceResult as CatalogMapResult,
  CatalogProject,
  ProjectResourceResult as CatalogProjectResult,
  TicketResourceResult as CatalogTicketResult,
  UnavailableEvidence as CatalogUnavailable,
  ResourceCatalogSnapshot,
} from '../resources/catalog.ts'

export function projectResourceCounts(snapshot: ResourceCatalogSnapshot | null): {
  projects: number | null
  maps: number | null
  unavailable: number | null
  absent: number | null
} {
  if (!snapshot) return { projects: null, maps: null, unavailable: null, absent: null }
  let maps: number | null = 0
  let unavailable = 0
  let absent = 0
  for (const project of snapshot.projects) {
    if (project.resource.kind === 'proven-absent') absent += 1
    else if (
      project.resource.kind === 'retained-unavailable' ||
      (project.resource.kind === 'never-observed' && project.resource.current !== null)
    )
      unavailable += 1
    if (project.mapsMembership.kind !== 'current-complete') maps = null
    else if (maps !== null) maps += project.mapsMembership.observation.value.members.length
  }
  return { projects: snapshot.projects.length, maps, unavailable, absent }
}

/** Projects persisted intent against real source evidence, without activating source owners. */
function projectResources(
  snapshot: ResourceCatalogSnapshot,
  configuration: ProjectConfiguration = snapshot.committed.registry,
  sourceLifetimeOwned = true,
) {
  const existing =
    configuration === snapshot.committed.registry
      ? null
      : new Map(snapshot.projects.map((project) => [projectKey(project.key), project]))
  const projects = configuration.projects.map((intent, index) => {
    const key = projectRefKey(intent)
    const prior = existing ? existing.get(projectKey(key)) : snapshot.projects[index]
    const project = prior
      ? !existing ||
        sameSourceIntent(prior.intent, intent, snapshot.committed.registry, configuration)
        ? prior
        : withoutCurrentSource(prior)
      : unobservedProject(intent)
    const admission = snapshot.committed.registry.admissions.find((record) =>
      sameProject(projectRefKey(record.intent), project.key),
    )
    const successful = successfulProject(project.resource)
    const known =
      successful &&
      'locator' in intent &&
      (successful.value.source.integration !== 'github' ||
        successful.value.source.repositoryId !== intent.locator.repositoryId)
        ? null
        : successful
    const source =
      'locator' in intent
        ? {
            integration: 'github',
            repositoryId: intent.locator.repositoryId,
            nameWithOwner:
              known?.value.source.integration === 'github'
                ? known.value.source.nameWithOwner
                : intent.locator.nameWithOwner,
            url:
              known?.value.source.integration === 'github'
                ? known.value.source.url
                : `https://github.com/${intent.locator.nameWithOwner}`,
          }
        : { integration: 'local', path: intent.workspace.path }
    return {
      integration: intent.ref.integration,
      ref: toProjectRef(key),
      connectionId: intent.connectionId,
      source,
      management: {
        ...('locator' in intent ? { workspacePath: intent.workspace.path } : {}),
        ...(intent.displayName === undefined ? {} : { displayName: intent.displayName }),
      },
      name: intent.displayName ?? known?.value.name ?? key.id,
      resource: projectProjectResult(project.resource),
      mapsMembership: projectMapsMembership(project.mapsMembership),
      maps: project.maps.map((map) => {
        const resolveBlocker = (blocker: SourceBlocker) =>
          projectBlocker(blocker, snapshot, map.key)
        return {
          ref: toMapRef(map.key),
          resource: projectMapResult(map.resource),
          ticketsMembership: projectTicketsMembership(map.ticketsMembership),
          tickets: map.tickets.map((ticket) => ({
            ref: toTicketRef(ticket.key),
            resource: projectTicketResult(ticket.resource, resolveBlocker),
          })),
          frontier: map.tickets.flatMap((ticket) => {
            const resource = ticket.resource
            const observation =
              resource.kind === 'current-readable'
                ? resource.observation
                : resource.kind === 'retained-unavailable'
                  ? resource.lastSuccessful
                  : resource.kind === 'proven-absent' &&
                      resource.trace.kind === 'last-successful-trace'
                    ? resource.trace.lastSuccessful
                    : null
            const content = observation?.value
            return observation?.completeness.kind === 'complete' &&
              content &&
              content.status === 'open' &&
              !content.isClaimed &&
              content.blockersComplete &&
              content.blockedBy.every((blocker) => blocker.state === 'closed')
              ? [toTicketRef(ticket.key)]
              : []
          }),
        }
      }),
      displayOrder: {
        open: project.displayOrder.openMapIds.map((mapId) => toMapRef({ project: key, mapId })),
        closed: project.displayOrder.closedMapIds.map((mapId) => toMapRef({ project: key, mapId })),
      },
      activeMap: projectActiveMap(project.activeMap, key),
      managementWarnings: !sourceLifetimeOwned
        ? ['Roadmap is not running; Workspace admission is unavailable.']
        : admission?.workspace.status === 'unavailable'
          ? [`Workspace unavailable: ${admission.workspace.error.message}`]
          : [],
      actions: projectActions(
        intent,
        sourceLifetimeOwned ? admission : undefined,
        known?.value.source,
      ),
    }
  })
  return { projects }
}

function unobservedProject(intent: ProjectConfigurationIntent): CatalogProject {
  const key = projectRefKey(intent)
  return {
    key,
    intent,
    resource: { kind: 'never-observed', scope: { kind: 'project', project: key }, current: null },
    mapsMembership: { kind: 'never-observed', current: null },
    maps: [],
    displayOrder: { openMapIds: [], closedMapIds: [] },
    activeMap: {
      kind: 'uncertain',
      lastKnown: { kind: 'none' },
      reason: 'never-observed',
      cause: 'Active map has never been established.',
    },
  }
}

function sameSourceIntent(
  a: ProjectConfigurationIntent,
  b: ProjectConfigurationIntent,
  previous: ProjectConfiguration,
  next: ProjectConfiguration,
): boolean {
  if (a.connectionId !== b.connectionId) return false
  if ('locator' in a && 'locator' in b) {
    const oldConnection = previous.connections.find(
      (connection) => connection.id === a.connectionId,
    )
    const newConnection = next.connections.find((connection) => connection.id === b.connectionId)
    return (
      a.locator.repositoryId === b.locator.repositoryId &&
      oldConnection?.integration === 'github' &&
      newConnection?.integration === 'github' &&
      oldConnection.githubIdentity.id === newConnection.githubIdentity.id
    )
  }
  return !('locator' in a) && !('locator' in b) && a.workspace.path === b.workspace.path
}

/** A saved binding change has no new read evidence and does not mutate catalog authority. */
function withoutCurrentSource(project: CatalogProject): CatalogProject {
  return {
    ...project,
    resource: withoutCurrentResource(project.resource),
    mapsMembership: withoutCurrentMembership(project.mapsMembership),
    maps: project.maps.map((map) => ({
      ...map,
      resource: withoutCurrentResource(map.resource),
      ticketsMembership: withoutCurrentMembership(map.ticketsMembership),
      tickets: map.tickets.map((ticket) => ({
        ...ticket,
        resource: withoutCurrentResource(ticket.resource),
      })),
    })),
    activeMap: {
      kind: 'uncertain',
      lastKnown:
        project.activeMap.kind === 'uncertain' ? project.activeMap.lastKnown : project.activeMap,
      reason: 'project-unavailable',
      cause: 'Project source is currently unavailable.',
    },
  }
}

type CatalogResourceResult = CatalogProjectResult | CatalogMapResult | CatalogTicketResult
type CatalogMembershipResult = CatalogProject['mapsMembership'] | CatalogMap['ticketsMembership']

function withoutCurrentResource(resource: CatalogProjectResult): CatalogProjectResult
function withoutCurrentResource(resource: CatalogMapResult): CatalogMapResult
function withoutCurrentResource(resource: CatalogTicketResult): CatalogTicketResult
function withoutCurrentResource(resource: CatalogResourceResult): CatalogResourceResult {
  const scope =
    resource.kind === 'never-observed'
      ? resource.scope
      : resource.kind === 'current-readable'
        ? resource.observation.scope
        : resource.kind === 'retained-unavailable'
          ? resource.lastSuccessful.scope
          : resource.absence.scope
  const unavailable: CatalogUnavailable = {
    kind: 'no-current-evidence',
    scope,
    readSequence: null,
    cause: 'No current source observation is available.',
  }
  const lastSuccessful =
    resource.kind === 'current-readable'
      ? resource.observation
      : resource.kind === 'retained-unavailable'
        ? resource.lastSuccessful
        : resource.kind === 'proven-absent' && resource.trace.kind === 'last-successful-trace'
          ? resource.trace.lastSuccessful
          : null
  if (lastSuccessful) {
    if (isObservationScope(lastSuccessful, 'project'))
      return { kind: 'retained-unavailable', lastSuccessful, unavailable }
    if (isObservationScope(lastSuccessful, 'map'))
      return { kind: 'retained-unavailable', lastSuccessful, unavailable }
    if (isObservationScope(lastSuccessful, 'ticket'))
      return { kind: 'retained-unavailable', lastSuccessful, unavailable }
    const exhaustive: never = lastSuccessful
    return exhaustive
  }
  switch (scope.kind) {
    case 'project':
      return { kind: 'never-observed', scope, current: unavailable }
    case 'map':
      return { kind: 'never-observed', scope, current: unavailable }
    case 'ticket':
      return { kind: 'never-observed', scope, current: unavailable }
  }
}

function withoutCurrentMembership(
  membership: CatalogProject['mapsMembership'],
): CatalogProject['mapsMembership']
function withoutCurrentMembership(
  membership: CatalogMap['ticketsMembership'],
): CatalogMap['ticketsMembership']
function withoutCurrentMembership(membership: CatalogMembershipResult): CatalogMembershipResult {
  const lastComplete =
    membership.kind === 'current-complete'
      ? membership.observation
      : membership.kind === 'current-incomplete' || membership.kind === 'unavailable'
        ? membership.lastComplete
        : null
  if (!lastComplete) return { kind: 'never-observed', current: null }
  const unavailable: CatalogUnavailable = {
    kind: 'no-current-evidence',
    scope: lastComplete.scope,
    readSequence: null,
    cause: 'No current source observation is available.',
  }
  if (isObservationScope(lastComplete, 'maps-membership'))
    return { kind: 'unavailable', lastComplete, unavailable }
  if (isObservationScope(lastComplete, 'tickets-membership'))
    return { kind: 'unavailable', lastComplete, unavailable }
  const exhaustive: never = lastComplete
  return exhaustive
}

function isObservationScope<A extends Observed, K extends A['scope']['kind']>(
  observation: A,
  kind: K,
): observation is Extract<A, { scope: { kind: K } }> {
  return observation.scope.kind === kind
}

function projectProjectResult(resource: CatalogProjectResult) {
  switch (resource.kind) {
    case 'never-observed':
      return {
        kind: 'never-observed',
        scope: projectScope(resource.scope),
        current: resource.current ? projectUnavailable(resource.current) : null,
      }
    case 'current-readable':
      return {
        kind: 'current-readable',
        observation: projectProjectObservation(resource.observation),
      }
    case 'retained-unavailable':
      return {
        kind: 'retained-unavailable',
        lastSuccessful: projectProjectObservation(resource.lastSuccessful),
        unavailable: projectUnavailable(resource.unavailable),
      }
    case 'proven-absent':
      return {
        kind: 'proven-absent',
        absence: absenceMetadata(resource.absence),
        trace:
          resource.trace.kind === 'no-known-trace'
            ? { kind: 'no-known-trace' }
            : {
                kind: 'last-successful-trace',
                lastSuccessful: projectProjectObservation(resource.trace.lastSuccessful),
              },
      }
  }
}
function projectMapResult(resource: CatalogMapResult) {
  switch (resource.kind) {
    case 'never-observed':
      return {
        kind: 'never-observed',
        scope: projectScope(resource.scope),
        current: resource.current ? projectUnavailable(resource.current) : null,
      }
    case 'current-readable':
      return { kind: 'current-readable', observation: projectMapObservation(resource.observation) }
    case 'retained-unavailable':
      return {
        kind: 'retained-unavailable',
        lastSuccessful: projectMapObservation(resource.lastSuccessful),
        unavailable: projectUnavailable(resource.unavailable),
      }
    case 'proven-absent':
      return {
        kind: 'proven-absent',
        absence: absenceMetadata(resource.absence),
        trace:
          resource.trace.kind === 'no-known-trace'
            ? { kind: 'no-known-trace' }
            : {
                kind: 'last-successful-trace',
                lastSuccessful: projectMapObservation(resource.trace.lastSuccessful),
              },
      }
  }
}
function projectTicketResult(
  resource: CatalogTicketResult,
  resolveBlocker: (blocker: SourceBlocker) => unknown,
) {
  switch (resource.kind) {
    case 'never-observed':
      return {
        kind: 'never-observed',
        scope: projectScope(resource.scope),
        current: resource.current ? projectUnavailable(resource.current) : null,
      }
    case 'current-readable':
      return {
        kind: 'current-readable',
        observation: projectTicketObservation(resource.observation, resolveBlocker),
      }
    case 'retained-unavailable':
      return {
        kind: 'retained-unavailable',
        lastSuccessful: projectTicketObservation(resource.lastSuccessful, resolveBlocker),
        unavailable: projectUnavailable(resource.unavailable),
      }
    case 'proven-absent':
      return {
        kind: 'proven-absent',
        absence: absenceMetadata(resource.absence),
        trace:
          resource.trace.kind === 'no-known-trace'
            ? { kind: 'no-known-trace' }
            : {
                kind: 'last-successful-trace',
                lastSuccessful: projectTicketObservation(
                  resource.trace.lastSuccessful,
                  resolveBlocker,
                ),
              },
      }
  }
}
function projectMapsMembership(membership: CatalogProject['mapsMembership']) {
  switch (membership.kind) {
    case 'never-observed':
      return {
        kind: 'never-observed',
        current: membership.current ? projectUnavailable(membership.current) : null,
      }
    case 'unavailable':
      return {
        kind: 'unavailable',
        unavailable: projectUnavailable(membership.unavailable),
        lastComplete: membership.lastComplete
          ? projectMapMembershipObservation(membership.lastComplete)
          : null,
      }
    case 'current-complete':
      return {
        kind: 'current-complete',
        observation: projectMapMembershipObservation(membership.observation),
      }
    case 'current-incomplete':
      return {
        kind: 'current-incomplete',
        observation: projectMapMembershipObservation(membership.observation),
        lastComplete: membership.lastComplete
          ? projectMapMembershipObservation(membership.lastComplete)
          : null,
      }
  }
}
function projectTicketsMembership(membership: CatalogProject['maps'][number]['ticketsMembership']) {
  switch (membership.kind) {
    case 'never-observed':
      return {
        kind: 'never-observed',
        current: membership.current ? projectUnavailable(membership.current) : null,
      }
    case 'unavailable':
      return {
        kind: 'unavailable',
        unavailable: projectUnavailable(membership.unavailable),
        lastComplete: membership.lastComplete
          ? projectTicketMembershipObservation(membership.lastComplete)
          : null,
      }
    case 'current-complete':
      return {
        kind: 'current-complete',
        observation: projectTicketMembershipObservation(membership.observation),
      }
    case 'current-incomplete':
      return {
        kind: 'current-incomplete',
        observation: projectTicketMembershipObservation(membership.observation),
        lastComplete: membership.lastComplete
          ? projectTicketMembershipObservation(membership.lastComplete)
          : null,
      }
  }
}
type Observed = Extract<ObservationAttempt, { kind: 'observed' }>
function observationMetadata(observation: Observed) {
  return {
    scope: projectScope(observation.scope),
    attemptedAt: observation.attemptedAt,
    observedAt: observation.observedAt,
    provenance: projectProvenance(observation.provenance),
    completeness: observation.completeness,
  }
}
function absenceMetadata(absence: AbsentAttempt) {
  return {
    scope: projectScope(absence.scope),
    attemptedAt: absence.attemptedAt,
    observedAt: absence.observedAt,
    provenance: projectProvenance(absence.provenance),
    proof:
      absence.proof.kind === 'complete-membership'
        ? { kind: absence.proof.kind, parent: projectScope(absence.proof.parent) }
        : { ...absence.proof },
  }
}
function projectProjectObservation(observation: Extract<Observed, { scope: { kind: 'project' } }>) {
  return {
    ...observationMetadata(observation),
    value: {
      name: observation.value.name,
      source: { ...observation.value.source },
      warnings: [...observation.value.warnings],
    },
  }
}
function projectMapObservation(observation: Extract<Observed, { scope: { kind: 'map' } }>) {
  return { ...observationMetadata(observation), value: projectMapValue(observation.value) }
}
function projectTicketObservation(
  observation: Extract<Observed, { scope: { kind: 'ticket' } }>,
  resolveBlocker: (blocker: SourceBlocker) => unknown,
) {
  return {
    ...observationMetadata(observation),
    value: projectTicketValue(observation.value, resolveBlocker),
  }
}
function projectMapMembershipObservation(
  observation: Extract<Observed, { scope: { kind: 'maps-membership' } }>,
) {
  return {
    ...observationMetadata(observation),
    value: { members: observation.value.members.map(toMapRef) },
  }
}
function projectTicketMembershipObservation(
  observation: Extract<Observed, { scope: { kind: 'tickets-membership' } }>,
) {
  return {
    ...observationMetadata(observation),
    value: { members: observation.value.members.map(toTicketRef) },
  }
}
function projectUnavailable(evidence: CatalogUnavailable) {
  switch (evidence.kind) {
    case 'no-current-evidence':
      return {
        kind: 'no-current-evidence',
        scope: projectScope(evidence.scope),
        cause: 'No current source observation is available.',
      }
    case 'incomplete-ancestor':
      return {
        kind: 'incomplete-ancestor',
        scope: projectScope(evidence.scope),
        attemptedAt: evidence.attemptedAt,
        observedAt: evidence.observedAt,
        provenance: projectProvenance(evidence.provenance),
        completeness: evidence.completeness,
        cause: 'Current ancestor source evidence is incomplete.',
      }
    case 'source-failure':
      return {
        kind: 'source-failure',
        scope: projectScope(evidence.scope),
        attemptedAt: evidence.attemptedAt,
        provenance: projectProvenance(evidence.provenance),
        failure: evidence.failure,
        cause: evidence.cause,
      }
  }
}
function projectActiveMap(active: CatalogProject['activeMap'], project: SourceProjectKey) {
  switch (active.kind) {
    case 'known-current':
      return { kind: 'known-current', ref: toMapRef({ project, mapId: active.mapId }) }
    case 'known-empty':
      return { kind: 'known-empty' }
    case 'uncertain': {
      switch (active.reason) {
        case 'never-observed':
          return {
            kind: 'uncertain',
            reason: active.reason,
            cause: 'Active map has never been established.',
          }
        case 'project-unavailable':
          return {
            kind: 'uncertain',
            reason: active.reason,
            cause: 'Project source is currently unavailable.',
          }
        case 'membership-unavailable':
          return {
            kind: 'uncertain',
            reason: active.reason,
            cause: 'Map membership is currently unavailable.',
          }
        case 'membership-incomplete':
          return {
            kind: 'uncertain',
            reason: active.reason,
            cause: 'Map membership is incomplete.',
          }
        case 'map-unavailable':
          return {
            kind: 'uncertain',
            reason: active.reason,
            cause: 'A map required for ordering is currently unavailable.',
          }
        case 'map-incomplete':
          return {
            kind: 'uncertain',
            reason: active.reason,
            cause: 'A map required for ordering is incomplete.',
          }
        case 'map-status-unknown':
          return {
            kind: 'uncertain',
            reason: active.reason,
            cause: 'A map required for ordering has unknown status.',
          }
      }
    }
  }
}
function successfulProject(resource: CatalogProjectResult) {
  switch (resource.kind) {
    case 'current-readable':
      return resource.observation
    case 'retained-unavailable':
      return resource.lastSuccessful
    case 'proven-absent':
      return resource.trace.kind === 'last-successful-trace' ? resource.trace.lastSuccessful : null
    case 'never-observed':
      return null
  }
}
function projectBlocker(
  blocker: SourceBlocker,
  snapshot: ResourceCatalogSnapshot,
  originatingMap: SourceMapKey,
) {
  const reference = blocker.reference
  let projected: unknown
  if (reference.kind === 'registered' && reference.project.integration === 'local') {
    projected = {
      kind: 'registered',
      ticket: toTicketRef({ map: originatingMap, ticketId: reference.ticketId }),
    }
  } else if (reference.kind === 'registered') {
    const matches = snapshot.projects
      .filter((project) => sameProject(project.key, reference.project))
      .flatMap((project) => project.maps.flatMap((map) => map.tickets))
      .filter((ticket) => ticket.key.ticketId === reference.ticketId)
    const match = matches.length === 1 ? matches[0] : undefined
    projected = match
      ? { kind: 'registered', ticket: toTicketRef(match.key) }
      : {
          kind: 'unresolved',
          locator: JSON.stringify([reference.project.integration, reference.project.id]),
          ticketId: reference.ticketId,
        }
  } else projected = { ...reference }
  return {
    reference: projected,
    state: blocker.state,
    ...(blocker.displayId === undefined ? {} : { displayId: blocker.displayId }),
    ...(blocker.title === undefined ? {} : { title: blocker.title }),
    ...(blocker.url === undefined ? {} : { url: blocker.url }),
  }
}
function projectTicketValue(
  ticket: SourceTicketContent,
  resolveBlocker: (blocker: SourceBlocker) => unknown,
) {
  const blockedBy = ticket.blockedBy.map(resolveBlocker)
  const isBlocked =
    ticket.status === 'unknown' ||
    !ticket.blockersComplete ||
    ticket.blockedBy.some((blocker) => blocker.state !== 'closed')
  const state =
    ticket.status === 'closed'
      ? 'closed'
      : isBlocked
        ? 'blocked'
        : ticket.isClaimed
          ? 'claimed'
          : 'frontier'
  const typeEvidence =
    ticket.typeEvidence.kind === 'missing'
      ? { kind: 'missing', labels: [] }
      : ticket.typeEvidence.kind === 'recognized'
        ? {
            kind: 'recognized',
            value: ticket.typeEvidence.value,
            labels: [...ticket.typeEvidence.labels],
          }
        : { kind: ticket.typeEvidence.kind, labels: [...ticket.typeEvidence.labels] }
  return {
    ...(ticket.displayId === undefined ? {} : { displayId: ticket.displayId }),
    ...(ticket.title === undefined ? {} : { title: ticket.title }),
    source: { ...ticket.source },
    status: ticket.status,
    body: ticket.body,
    typeEvidence,
    state,
    isClaimed: ticket.isClaimed,
    isBlocked,
    ...(ticket.createdAt === undefined ? {} : { createdAt: ticket.createdAt }),
    ...(ticket.closedAt === undefined ? {} : { closedAt: ticket.closedAt }),
    assignees: ticket.assignees.map((assignee) => ({ ...assignee })),
    blockedBy,
    blockersComplete: ticket.blockersComplete,
    warnings: [...ticket.warnings],
  }
}
function projectMapValue(map: SourceMapContent) {
  return {
    ...(map.displayId === undefined ? {} : { displayId: map.displayId }),
    ...(map.title === undefined ? {} : { title: map.title }),
    source: { ...map.source },
    status: map.status,
    updatedAt: map.updatedAt,
    ...(map.closedAt === undefined ? {} : { closedAt: map.closedAt }),
    body: {
      ...map.body,
      notes: [...map.body.notes],
      decisions: map.body.decisions.map((decision) => ({ ...decision })),
      notYetSpecified: [...map.body.notYetSpecified],
      outOfScope: [...map.body.outOfScope],
      sections: map.body.sections.map((section) => ({ ...section, items: [...section.items] })),
      missingSections: [...map.body.missingSections],
    },
    progress: map.progress === null ? null : { ...map.progress },
    warnings: [...map.warnings, ...map.unidentifiedTickets.flatMap((ticket) => ticket.warnings)],
  }
}

export function projectApplicationState(input: {
  resources: ResourceCatalogSnapshot
  intent: ProjectConfiguration
  retainedConnections: readonly Connection[] | null
  sourceLifetimeOwned: boolean
  serverEpoch: string
  stateSequence: number
  capturedAt: number
  mode: 'mutable' | 'read-only'
  supportedIntegrations: readonly SupportedIntegration[]
  authorizationOperations:
    | readonly AuthorizationFact[]
    | readonly ReadyApplicationState['authorizationOperations'][number][]
  configuration: ReadyApplicationState['configuration']
  automation: {
    enabled: boolean
    enabledProjects: readonly SourceProjectKey[]
    availability: ReadyApplicationState['automation']['availability']
    evidence: readonly AutomationEvidence[]
    overrides: readonly AutomationOverrideControl[]
  }
}): ReadyApplicationState {
  const connections = input.intent.connections.map((connection) => ({
    ...connection,
    availability:
      input.retainedConnections === null
        ? connectionHealth(input.resources.committed, connection)
        : (input.retainedConnections.find((retained) => sameConnectionAccount(retained, connection))
            ?.availability ?? unobservedConnectionAvailability()),
  }))
  const authorizationOperations = input.authorizationOperations
    .map((operation) => {
      if (operation.status === 'starting') return null
      if (operation.status === 'granted') {
        const id = 'connection' in operation ? operation.connection.id : operation.connectionId
        const accountId =
          'connection' in operation ? operation.connection.accountId : operation.accountId
        const current = connections.some(
          (candidate) =>
            candidate.id === id &&
            candidate.integration === 'github' &&
            candidate.githubIdentity.id === accountId,
        )
        return {
          id: operation.id,
          status: 'granted',
          connection: { kind: current ? 'current' : 'historical', id, accountId },
        }
      }
      if (operation.status === 'waiting' || operation.status === 'terminal') return { ...operation }
      return {
        id: operation.id,
        status: 'terminal',
        outcome: operation.status,
        ...(operation.connectionId === undefined ? {} : { connectionId: operation.connectionId }),
        ...(operation.status === 'failed' || operation.status === 'denied'
          ? { cause: operation.cause }
          : {}),
      }
    })
    .filter((operation) => operation !== null)
  return readyApplicationStateSchema.parse({
    phase: 'ready',
    mode: input.mode,
    serverEpoch: input.serverEpoch,
    stateSequence: input.stateSequence,
    capturedAt: input.capturedAt,
    configurationVersion: input.intent.configurationVersion,
    supportedIntegrations: [...input.supportedIntegrations],
    connections,
    projects: projectResources(input.resources, input.intent, input.sourceLifetimeOwned).projects,
    authorizationOperations,
    configuration: input.configuration,
    automation: {
      ...input.automation,
      enabledProjects: input.automation.enabledProjects.map(toProjectRef),
      evidence: input.automation.evidence.map((evidence) => ({
        target: toTicketRef({
          map: { project: evidence.target.project, mapId: evidence.target.mapId },
          ticketId: evidence.target.ticketId,
        }),
        classification: evidence.classification,
        ...(evidence.wayfinder === undefined ? {} : { wayfinder: evidence.wayfinder }),
      })),
      overrides: input.automation.overrides.map((control) => ({
        target: toTicketRef({
          map: { project: control.target.project, mapId: control.target.mapId },
          ticketId: control.target.ticketId,
        }),
        classification: control.classification,
        wayfinder: control.wayfinder,
      })),
    },
  })
}

function sameConnectionAccount(
  a: ConfiguredConnection | Connection,
  b: ConfiguredConnection | Connection,
): boolean {
  return (
    a.id === b.id &&
    a.integration === b.integration &&
    (a.integration === 'local' ||
      b.integration === 'local' ||
      a.githubIdentity.id === b.githubIdentity.id)
  )
}
function unobservedConnectionAvailability(): ConnectionAvailability {
  return {
    status: 'unavailable',
    cause: 'No current evidence is available for this configured Connection.',
  }
}

function connectionHealth(
  committed: CommittedObservation,
  connection: ConfiguredConnection,
): ConnectionAvailability {
  if (!committed.registry.connections.some((prior) => sameConnectionAccount(prior, connection)))
    return unobservedConnectionAvailability()
  const { id, integration } = connection
  const usability = committed.authorizationUsability.get(id)
  const projectIds = new Set(
    committed.registry.projects
      .filter((project) => project.connectionId === id)
      .map(projectRefKey)
      .map(projectKey),
  )
  const health = committed.contributions
    .filter((source) => projectIds.has(projectKey(source.project)))
    .map((source) => source.health)
  const failed =
    health.find((value) => value.status === 'authorization-required') ??
    health.find((value) => value.status === 'unavailable') ??
    health.find((value) => value.status === 'degraded')
  const successTimes = health.flatMap((value) =>
    value.observedAt === undefined ? [] : [value.observedAt],
  )
  const observedAt = successTimes.length === 0 ? undefined : Math.max(...successTimes)
  if (usability && usability.status !== 'usable')
    return {
      status: usability.status,
      cause: usability.cause,
      ...(observedAt === undefined ? {} : { observedAt }),
    }
  if (failed?.status === 'degraded')
    return observedAt === undefined
      ? {
          status: 'unavailable',
          cause: 'Source observations are temporarily failing for this Connection.',
        }
      : { status: 'degraded', cause: failed.cause, observedAt }
  if (failed)
    return {
      status: failed.status,
      cause: failed.cause,
      ...(observedAt === undefined ? {} : { observedAt }),
    }
  if (health.length > 0)
    return { status: 'available', ...(observedAt === undefined ? {} : { observedAt }) }
  return integration === 'local' || usability?.status === 'usable'
    ? { status: 'available' }
    : { status: 'authorization-required', cause: 'Authorization is required.' }
}
function projectRefKey(intent: ProjectConfigurationIntent): SourceProjectKey {
  return { integration: intent.ref.integration, id: intent.ref.projectId }
}
function projectActions(
  intent: ProjectConfigurationIntent,
  admission: ProjectAdmissionRecord | undefined,
  source: Extract<Observed, { scope: { kind: 'project' } }>['value']['source'] | undefined,
) {
  const actions: unknown[] = [
    {
      id: 'open-roadmap',
      label: 'Open in Roadmap',
      kind: 'roadmap',
      href: `/projects/${intent.ref.integration}/${encodeURIComponent(intent.ref.projectId)}`,
    },
  ]
  if (
    admission?.workspace.status === 'admitted' &&
    admission.intent.connectionId === intent.connectionId &&
    ('locator' in intent
      ? 'matchedRepositoryId' in admission.workspace.proof &&
        admission.workspace.proof.matchedRepositoryId === intent.locator.repositoryId &&
        admission.workspace.proof.verifiedConnectionId === intent.connectionId
      : !('matchedRepositoryId' in admission.workspace.proof))
  ) {
    actions.push(
      {
        id: 'open-workspace',
        label: 'Open in VS Code',
        kind: 'server-launch',
        operation: 'open-workspace',
      },
      {
        id: 'open-terminal',
        label: 'Open Terminal',
        kind: 'server-launch',
        operation: 'open-terminal',
      },
      {
        id: 'reveal-source',
        label: 'View source folder',
        kind: 'server-launch',
        operation: 'reveal-source',
      },
    )
  }
  if ('locator' in intent)
    actions.push({
      id: 'open-source',
      label: 'Open on GitHub',
      kind: 'external-link',
      href:
        source?.integration === 'github'
          ? source.url
          : `https://github.com/${intent.locator.nameWithOwner}`,
    })
  return actions
}
function toProjectRef(project: SourceProjectKey): ProjectRef {
  return projectRefSchema.parse({ integration: project.integration, projectId: project.id })
}
function toMapRef(map: SourceMapKey) {
  return mapRefSchema.parse({ project: toProjectRef(map.project), mapId: map.mapId })
}
function toTicketRef(ticket: SourceTicketKey): TicketRef {
  return ticketRefSchema.parse({ map: toMapRef(ticket.map), ticketId: ticket.ticketId })
}
function projectScope(scope: SourceScope) {
  switch (scope.kind) {
    case 'project':
    case 'maps-membership':
      return { kind: scope.kind, project: toProjectRef(scope.project) }
    case 'map':
    case 'tickets-membership':
      return { kind: scope.kind, map: toMapRef(scope.map) }
    case 'ticket':
      return { kind: scope.kind, ticket: toTicketRef(scope.ticket) }
  }
}
function projectProvenance(provenance: Observed['provenance']) {
  return provenance.integration === 'github'
    ? { ...provenance, connectionId: connectionIdSchema.parse(provenance.connectionId) }
    : { ...provenance }
}
function sameProject(a: SourceProjectKey, b: SourceProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
function projectKey(project: SourceProjectKey): string {
  return JSON.stringify([project.integration, project.id])
}
