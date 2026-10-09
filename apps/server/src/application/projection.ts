import type {
  ActiveMapResult,
  ApplicationState,
  AuthorizationOperation,
  Blocker,
  ConnectionAvailability,
  MapMembershipResult,
  MapResourceResult,
  MapResourceValue,
  ProjectKey,
  ProjectRegistration,
  ProjectResourceResult,
  RegisteredProject,
  SupportedIntegration,
  TicketMembershipResult,
  TicketResourceResult,
  TicketResourceValue,
  UnavailableEvidence,
} from '@roadmap/contracts'
import type { CommittedObservation } from '../observation/coordinator.ts'
import type {
  AbsentAttempt,
  ObservationAttempt,
  SourceBlocker,
  SourceMapContent,
  SourceTicketContent,
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

export interface PublicSourceProjection {
  roadmap: ApplicationState['roadmap']
  registrations: ProjectRegistration[]
  projects: RegisteredProject[]
}

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
export function projectResources(
  snapshot: ResourceCatalogSnapshot,
  configuration: ProjectConfiguration = snapshot.committed.registry,
  sourceLifetimeOwned = true,
): PublicSourceProjection {
  const existing =
    configuration === snapshot.committed.registry
      ? null
      : new Map(snapshot.projects.map((project) => [projectKey(project.key), project]))
  const registrations = configuration.projects.map(projectConfiguredRegistration)
  const projects = configuration.projects.map((intent, index): RegisteredProject => {
    const registration = registrations[index] ?? projectConfiguredRegistration(intent)
    const prior = existing ? existing.get(projectKey(registration.key)) : snapshot.projects[index]
    const project = prior
      ? !existing ||
        sameSourceIntent(prior.intent, intent, snapshot.committed.registry, configuration)
        ? prior
        : withoutCurrentSource(prior)
      : unobservedProject(intent)
    const admission = snapshot.committed.registry.admissions.find((record) =>
      sameProject(projectRefKey(record.intent), project.key),
    )
    const known = successfulProject(project.resource)
    return {
      ...registration,
      name: registration.displayName ?? known?.value.name ?? registration.key.id,
      resource: projectProjectResult(project.resource),
      mapsMembership: projectMapsMembership(project.mapsMembership),
      maps: project.maps.map((map) => ({
        key: map.key,
        resource: projectMapResult(map.resource),
        ticketsMembership: projectTicketsMembership(map.ticketsMembership),
        tickets: map.tickets.map((ticket) => ({
          key: ticket.key,
          resource: projectTicketResult(ticket.resource),
        })),
      })),
      displayOrder: {
        openMapIds: [...project.displayOrder.openMapIds],
        closedMapIds: [...project.displayOrder.closedMapIds],
      },
      activeMap: projectActiveMap(project.activeMap),
      managementWarnings: !sourceLifetimeOwned
        ? ['Roadmap is not running; Workspace admission is unavailable.']
        : admission?.workspace.status === 'unavailable'
          ? [`Workspace unavailable: ${admission.workspace.error.message}`]
          : [],
      actions: projectActions(
        registration,
        sourceLifetimeOwned ? admission : undefined,
        known?.value.source,
      ),
    }
  })
  return {
    roadmap: { capturedAt: snapshot.committed.observation.committedAt },
    registrations,
    projects,
  }
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

function projectProjectResult(resource: CatalogProjectResult): ProjectResourceResult {
  switch (resource.kind) {
    case 'never-observed':
      return {
        kind: 'never-observed',
        scope: resource.scope,
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
function projectMapResult(resource: CatalogMapResult): MapResourceResult {
  switch (resource.kind) {
    case 'never-observed':
      return {
        kind: 'never-observed',
        scope: resource.scope,
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
function projectTicketResult(resource: CatalogTicketResult): TicketResourceResult {
  switch (resource.kind) {
    case 'never-observed':
      return {
        kind: 'never-observed',
        scope: resource.scope,
        current: resource.current ? projectUnavailable(resource.current) : null,
      }
    case 'current-readable':
      return {
        kind: 'current-readable',
        observation: projectTicketObservation(resource.observation),
      }
    case 'retained-unavailable':
      return {
        kind: 'retained-unavailable',
        lastSuccessful: projectTicketObservation(resource.lastSuccessful),
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
                lastSuccessful: projectTicketObservation(resource.trace.lastSuccessful),
              },
      }
  }
}
function projectMapsMembership(membership: CatalogProject['mapsMembership']): MapMembershipResult {
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
function projectTicketsMembership(
  membership: CatalogProject['maps'][number]['ticketsMembership'],
): TicketMembershipResult {
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
type PublicObservationMetadata = Omit<
  Extract<ProjectResourceResult, { kind: 'current-readable' }>['observation'],
  'value'
>
type PublicAbsence = Extract<ProjectResourceResult, { kind: 'proven-absent' }>['absence']
function observationMetadata<A extends Observed>(
  observation: A,
): Pick<A, keyof PublicObservationMetadata> {
  return {
    scope: observation.scope,
    attemptedAt: observation.attemptedAt,
    observedAt: observation.observedAt,
    provenance: observation.provenance,
    completeness: observation.completeness,
  }
}
function absenceMetadata<A extends AbsentAttempt>(absence: A): Pick<A, keyof PublicAbsence> {
  return {
    scope: absence.scope,
    attemptedAt: absence.attemptedAt,
    observedAt: absence.observedAt,
    provenance: absence.provenance,
    proof: absence.proof,
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
function projectTicketObservation(observation: Extract<Observed, { scope: { kind: 'ticket' } }>) {
  return { ...observationMetadata(observation), value: projectTicketValue(observation.value) }
}
function projectMapMembershipObservation<
  A extends Extract<Observed, { scope: { kind: 'maps-membership' } }>,
>(observation: A) {
  return { ...observationMetadata(observation), value: { members: [...observation.value.members] } }
}
function projectTicketMembershipObservation<
  A extends Extract<Observed, { scope: { kind: 'tickets-membership' } }>,
>(observation: A) {
  return { ...observationMetadata(observation), value: { members: [...observation.value.members] } }
}
function projectUnavailable(evidence: CatalogUnavailable): UnavailableEvidence {
  switch (evidence.kind) {
    case 'no-current-evidence':
      return {
        kind: 'no-current-evidence',
        scope: evidence.scope,
        cause: 'No current source observation is available.',
      }
    case 'incomplete-ancestor':
      return {
        kind: 'incomplete-ancestor',
        scope: evidence.scope,
        attemptedAt: evidence.attemptedAt,
        observedAt: evidence.observedAt,
        provenance: evidence.provenance,
        completeness: evidence.completeness,
        cause: 'Current ancestor source evidence is incomplete.',
      }
    case 'source-failure':
      return {
        kind: 'source-failure',
        scope: evidence.scope,
        attemptedAt: evidence.attemptedAt,
        provenance: evidence.provenance,
        failure: evidence.failure,
        cause: evidence.cause,
      }
  }
}
function projectActiveMap(active: CatalogProject['activeMap']): ActiveMapResult {
  switch (active.kind) {
    case 'known-current':
      return { kind: 'known-current', mapId: active.mapId }
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
function projectBlocker(blocker: SourceBlocker): Blocker {
  const { ticketId, ...reference } = blocker.reference
  return {
    reference,
    ticketId,
    state: blocker.state,
    ...(blocker.displayId === undefined ? {} : { displayId: blocker.displayId }),
    ...(blocker.title === undefined ? {} : { title: blocker.title }),
    ...(blocker.url === undefined ? {} : { url: blocker.url }),
  }
}
function projectTicketValue(ticket: SourceTicketContent): TicketResourceValue {
  const blockedBy = ticket.blockedBy.map(projectBlocker)
  const isBlocked =
    ticket.status === 'unknown' ||
    !ticket.blockersComplete ||
    blockedBy.some((blocker) => blocker.state !== 'closed')
  const state =
    ticket.status === 'closed'
      ? 'closed'
      : isBlocked
        ? 'blocked'
        : ticket.isClaimed
          ? 'claimed'
          : 'frontier'
  const typeEvidence: TicketResourceValue['typeEvidence'] =
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
function projectMapValue(map: SourceMapContent): MapResourceValue {
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
  committed: CommittedObservation
  intent: ProjectConfiguration
  retainedConnections: readonly ApplicationState['connections'][number][] | null
  source: PublicSourceProjection
  serverEpoch: string
  stateSequence: number
  supportedIntegrations: readonly SupportedIntegration[]
  authorizationOperations: readonly AuthorizationOperation[]
  configuration: ApplicationState['configuration']
  automation: ApplicationState['automation']
}): ApplicationState {
  return {
    serverEpoch: input.serverEpoch,
    stateSequence: input.stateSequence,
    configurationVersion: input.intent.configurationVersion,
    supportedIntegrations: [...input.supportedIntegrations],
    connections: input.intent.connections.map((connection) => ({
      ...connection,
      availability:
        input.retainedConnections === null
          ? connectionHealth(input.committed, connection)
          : (input.retainedConnections.find((retained) =>
              sameConnectionAccount(retained, connection),
            )?.availability ?? unobservedConnectionAvailability()),
    })),
    registrations: input.source.registrations,
    projects: input.source.projects,
    authorizationOperations: [...input.authorizationOperations],
    configuration: input.configuration,
    automation: input.automation,
    roadmap: input.source.roadmap,
  }
}
type ConnectionIdentity = Pick<
  ApplicationState['connections'][number],
  'id' | 'integration' | 'githubIdentity'
>

function sameConnectionAccount(a: ConnectionIdentity, b: ConnectionIdentity): boolean {
  return (
    a.id === b.id &&
    a.integration === b.integration &&
    (a.integration === 'local' ||
      (a.githubIdentity !== undefined && a.githubIdentity.id === b.githubIdentity?.id))
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
function projectConfiguredRegistration(intent: ProjectConfigurationIntent): ProjectRegistration {
  return {
    key: projectRefKey(intent),
    connectionId: intent.connectionId,
    ...(intent.displayName === undefined ? {} : { displayName: intent.displayName }),
    workspace:
      'locator' in intent
        ? { path: intent.workspace.path, gitIdentity: intent.locator.repositoryId }
        : { ...intent.workspace },
    locator:
      'locator' in intent
        ? { integration: 'github', ...intent.locator }
        : { integration: 'local', path: intent.workspace.path },
  }
}
function projectRefKey(intent: ProjectConfigurationIntent): ProjectKey {
  return { integration: intent.ref.integration, id: intent.ref.projectId }
}
function projectActions(
  registration: ProjectRegistration,
  admission: ProjectAdmissionRecord | undefined,
  source: Extract<Observed, { scope: { kind: 'project' } }>['value']['source'] | undefined,
): RegisteredProject['actions'] {
  const actions: RegisteredProject['actions'] = [
    {
      id: 'open-roadmap',
      label: 'Open in Roadmap',
      kind: 'roadmap',
      href: `/projects/${registration.key.integration}/${encodeURIComponent(registration.key.id)}`,
    },
  ]
  if (
    admission?.workspace.status === 'admitted' &&
    admission.intent.connectionId === registration.connectionId &&
    (registration.locator.integration === 'github'
      ? 'matchedRepositoryId' in admission.workspace.proof &&
        admission.workspace.proof.matchedRepositoryId === registration.locator.repositoryId &&
        admission.workspace.proof.verifiedConnectionId === registration.connectionId
      : !('matchedRepositoryId' in admission.workspace.proof))
  )
    actions.push(
      { id: 'open-workspace', label: 'Open in VS Code', kind: 'server-launch' },
      { id: 'open-terminal', label: 'Open Terminal', kind: 'server-launch' },
      { id: 'reveal-source', label: 'View source folder', kind: 'server-launch' },
    )
  if (registration.locator.integration === 'github')
    actions.push({
      id: 'open-source',
      label: 'Open on GitHub',
      kind: 'external-link',
      href:
        source?.integration === 'github'
          ? source.url
          : `https://github.com/${registration.locator.nameWithOwner}`,
    })
  return actions
}
function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
function projectKey(project: ProjectKey): string {
  return JSON.stringify([project.integration, project.id])
}
