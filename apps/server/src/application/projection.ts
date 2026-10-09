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
import type { ProjectAdmissionRecord, ProjectConfigurationIntent } from '../projects/registry.ts'
import type {
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

/** Translates one committed catalog without retaining or reconstructing source facts. */
export function projectResources(snapshot: ResourceCatalogSnapshot): PublicSourceProjection {
  const registrations = snapshot.projects.map((project) =>
    projectConfiguredRegistration(project.intent),
  )
  const projects = snapshot.projects.map((project, index): RegisteredProject => {
    const registration = registrations[index] ?? projectConfiguredRegistration(project.intent)
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
      managementWarnings:
        admission?.workspace.status === 'unavailable'
          ? [`Workspace unavailable: ${admission.workspace.error.message}`]
          : [],
      actions: projectActions(registration, admission, known?.value.source),
    }
  })
  return {
    roadmap: { capturedAt: snapshot.committed.observation.committedAt },
    registrations,
    projects,
  }
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
    configurationVersion: input.committed.registry.configurationVersion,
    supportedIntegrations: [...input.supportedIntegrations],
    connections: input.committed.registry.connections.map((connection) => ({
      ...connection,
      availability: connectionHealth(input.committed, connection.id, connection.integration),
    })),
    registrations: input.source.registrations,
    projects: input.source.projects,
    authorizationOperations: [...input.authorizationOperations],
    configuration: input.configuration,
    automation: input.automation,
    roadmap: input.source.roadmap,
  }
}
function connectionHealth(
  committed: CommittedObservation,
  id: string,
  integration: string,
): ConnectionAvailability {
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
