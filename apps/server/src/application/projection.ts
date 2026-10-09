import type {
  ApplicationState,
  AuthorizationOperation,
  Blocker,
  ConnectionAvailability,
  Project,
  ProjectKey,
  ProjectRegistration,
  RegisteredProject,
  Snapshot,
  SupportedIntegration,
  Ticket,
  Unreachable,
  WayfinderMap,
} from '@roadmap/contracts'
import type { CommittedObservation } from '../observation/coordinator.ts'
import {
  type ObservationAttempt,
  type SourceBlocker,
  type SourceFailure,
  type SourceMapContent,
  type SourceMapKey,
  type SourceScope,
  type SourceTicketContent,
  sourceScopeKey,
} from '../observation/source.ts'
import type { ProjectAdmissionRecord, ProjectConfigurationIntent } from '../projects/registry.ts'

export interface PublicSourceProjection {
  roadmap: Snapshot
  registrations: ProjectRegistration[]
  projects: RegisteredProject[]
}

/** Retains the existing scoped presentation contract until the ResourceCatalog cutover. */
export function createSourceProjection() {
  let roadmap: Snapshot = { capturedAt: 0, projects: [], unreachable: [] }
  const successfulScopes = new Map<string, Extract<ObservationAttempt, { kind: 'observed' }>>()
  let currentScopes = new Map<string, ObservationAttempt>()
  const mapMembers = new Map<string, readonly SourceMapKey[]>()
  const ticketMembers = new Map<string, readonly SourceTicketContent['key'][]>()
  const successfulProjectTimes = new Map<string, number>()
  const retainedMapOrder = new Map<string, readonly string[]>()
  const projectedProjects = new Map<string, { trace: Project; available: boolean; cause: string }>()
  function retainObservation(attempt: ObservationAttempt): void {
    if (attempt.kind !== 'observed') return
    const key = sourceScopeKey(attempt.scope)
    successfulScopes.set(key, attempt)
    const maps = observedMaps(attempt)
    if (maps)
      mapMembers.set(
        key,
        mergeMembers(
          mapMembers.get(key) ?? [],
          maps.value.members,
          maps.completeness.kind === 'complete',
          (map) => map.mapId,
        ),
      )
    const tickets = observedTickets(attempt)
    if (tickets)
      ticketMembers.set(
        key,
        mergeMembers(
          ticketMembers.get(key) ?? [],
          tickets.value.members,
          tickets.completeness.kind === 'complete',
          (ticket) => ticket.ticketId,
        ),
      )
  }

  function acceptObservation(
    snapshot: CommittedObservation['observation'],
    registrations: readonly ProjectRegistration[],
  ): void {
    currentScopes = new Map(
      snapshot.attempts.map((attempt) => [sourceScopeKey(attempt.scope), attempt]),
    )
    for (const attempt of snapshot.attempts) retainObservation(attempt)
    const projects: Project[] = []
    const unreachable: Unreachable[] = []
    projectedProjects.clear()
    const sourceProjects = new Map<string, ProjectKey>()
    for (const attempt of successfulScopes.values()) {
      const project = sourceProject(attempt.scope)
      sourceProjects.set(projectKey(project), project)
    }
    for (const attempt of snapshot.attempts) {
      const project = sourceProject(attempt.scope)
      sourceProjects.set(projectKey(project), project)
    }
    for (const registration of registrations)
      sourceProjects.set(projectKey(registration.key), registration.key)
    for (const project of sourceProjects.values()) {
      const result = projectSource(project)
      projectedProjects.set(projectKey(project), result)
      if (result.current) projects.push(result.current)
      unreachable.push(...result.unreachable)
    }
    projects.sort(
      (a, b) =>
        Number(b.openMaps.length > 0) - Number(a.openMaps.length > 0) ||
        a.name.localeCompare(b.name),
    )
    unreachable.sort(
      (a, b) =>
        projectKey(a.project).localeCompare(projectKey(b.project)) ||
        (a.mapId ?? '').localeCompare(b.mapId ?? '') ||
        a.reason.localeCompare(b.reason),
    )
    roadmap = { capturedAt: snapshot.committedAt, projects, unreachable }
  }

  function projectTickets(map: SourceMapKey) {
    const membershipScope: SourceScope = { kind: 'tickets-membership', map }
    const membership = observedTickets(currentScopes.get(sourceScopeKey(membershipScope)))
    const retainedKeys = new Map<string, SourceTicketContent['key']>()
    for (const ticket of ticketMembers.get(sourceScopeKey(membershipScope)) ?? [])
      retainedKeys.set(ticket.ticketId, ticket)
    for (const attempt of successfulScopes.values()) {
      if (attempt.scope.kind === 'ticket' && sameSourceMap(attempt.scope.ticket.map, map))
        retainedKeys.set(attempt.scope.ticket.ticketId, attempt.scope.ticket)
    }
    const trace: Ticket[] = []
    const current: Ticket[] = []
    let valid = membership?.completeness.kind === 'complete'
    const currentIds = new Set(membership?.value.members.map((ticket) => ticket.ticketId) ?? [])
    for (const ticket of retainedKeys.values()) {
      const scope: SourceScope = { kind: 'ticket', ticket }
      const retained = observedTicket(successfulScopes.get(sourceScopeKey(scope)))
      const live = observedTicket(currentScopes.get(sourceScopeKey(scope)))
      const included =
        !!membership &&
        (membership.completeness.kind !== 'complete' || currentIds.has(ticket.ticketId))
      const ticketValid =
        !!live &&
        live.completeness.kind === 'complete' &&
        live.value.status !== 'unknown' &&
        live.value.blockersComplete
      if (retained) trace.push(projectTicket(retained.value, included && ticketValid))
      if (live && included) current.push(projectTicket(live.value, ticketValid))
      if (
        (included && !ticketValid) ||
        (retained && !included && retained.value.status !== 'closed')
      )
        valid = false
    }
    return { trace, current, valid }
  }

  function projectScopedMap(map: SourceMapKey, included: boolean, absent: boolean) {
    const scope: SourceScope = { kind: 'map', map }
    const retained = observedMap(successfulScopes.get(sourceScopeKey(scope)))
    const latest = currentScopes.get(sourceScopeKey(scope))
    const live = observedMap(latest)
    const tickets = projectTickets(map)
    const valid =
      !!live &&
      included &&
      live.completeness.kind === 'complete' &&
      live.value.status !== 'unknown' &&
      live.value.progress !== null &&
      tickets.valid
    const ticketScope: SourceScope = { kind: 'tickets-membership', map }
    const ticketAttempt = currentScopes.get(sourceScopeKey(ticketScope))
    const failedTicket = [...currentScopes.values()].find(
      (attempt) =>
        attempt.kind === 'failed' &&
        attempt.scope.kind === 'ticket' &&
        sameSourceMap(attempt.scope.ticket.map, map),
    )
    let reason: string | undefined
    if (absent || latest?.kind === 'proven-absent')
      reason = 'Map is absent from the complete current source membership.'
    else if (latest?.kind === 'failed') reason = sourceFailureMessage(latest.failure)
    else if (ticketAttempt?.kind === 'failed') reason = sourceFailureMessage(ticketAttempt.failure)
    else if (failedTicket?.kind === 'failed') reason = sourceFailureMessage(failedTicket.failure)
    else if (!live && retained) reason = 'Map has no current successful source observation.'
    else if (!valid) reason = 'Map source evidence is incomplete.'
    return {
      valid,
      reason,
      retained,
      trace: retained ? projectMap(retained.value, tickets.trace, valid) : undefined,
      current: live && included ? projectMap(live.value, tickets.current, valid) : undefined,
    }
  }

  function projectMaps(
    project: ProjectKey,
    projectName: string | undefined,
    membership: ObservedMaps | undefined,
  ) {
    const membershipKey = sourceScopeKey({ kind: 'maps-membership', project })
    const known = new Map<string, SourceMapKey>()
    for (const map of mapMembers.get(membershipKey) ?? []) known.set(map.mapId, map)
    for (const attempt of successfulScopes.values()) {
      if (attempt.scope.kind === 'map' && sameProject(attempt.scope.map.project, project))
        known.set(attempt.scope.map.mapId, attempt.scope.map)
    }
    const trace: WayfinderMap[] = []
    const current: WayfinderMap[] = []
    const failures: Unreachable[] = []
    let complete = membership?.completeness.kind === 'complete'
    const currentIds = new Set(membership?.value.members.map((map) => map.mapId) ?? [])
    for (const map of known.values()) {
      const absent = membership?.completeness.kind === 'complete' && !currentIds.has(map.mapId)
      const result = projectScopedMap(map, !!membership && !absent, absent)
      if (!result.valid) complete = false
      if (result.trace) trace.push(result.trace)
      if (result.current) current.push(result.current)
      if (result.reason)
        failures.push({
          integration: project.integration,
          project,
          projectName,
          mapId: map.mapId,
          ...(result.retained?.value.displayId === undefined
            ? {}
            : { mapDisplayId: result.retained.value.displayId }),
          ...(result.retained?.value.title === undefined
            ? {}
            : { mapTitle: result.retained.value.title }),
          reason: result.reason,
        })
    }
    return { trace, current, complete, failures, currentIds }
  }

  function orderRetainedMaps(key: string, maps: WayfinderMap[], complete: boolean): WayfinderMap[] {
    const open = maps.filter((map) => map.isOpen)
    if (complete) {
      open.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      retainedMapOrder.set(
        key,
        open.map((map) => map.id),
      )
    } else {
      const positions = new Map((retainedMapOrder.get(key) ?? []).map((id, index) => [id, index]))
      open.sort(
        (a, b) =>
          (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
          b.updatedAt - a.updatedAt ||
          a.id.localeCompare(b.id),
      )
    }
    return open
  }

  function projectSource(project: ProjectKey): {
    trace: Project
    current?: Project
    available: boolean
    cause: string
    unreachable: Unreachable[]
  } {
    const key = projectKey(project)
    const projectScope: SourceScope = { kind: 'project', project }
    const listScope: SourceScope = { kind: 'maps-membership', project }
    const metadata = observedProject(successfulScopes.get(sourceScopeKey(projectScope)))
    const liveMetadata = observedProject(currentScopes.get(sourceScopeKey(projectScope)))
    const liveList = observedMaps(currentScopes.get(sourceScopeKey(listScope)))
    const membershipKey = sourceScopeKey(listScope)
    const maps = projectMaps(project, metadata?.value.name, liveList)
    const { trace: traceMaps, current: currentMaps, failures, currentIds } = maps
    const complete = liveMetadata?.completeness.kind === 'complete' && maps.complete
    const projectAttempt = currentScopes.get(sourceScopeKey(projectScope))
    const listAttempt = currentScopes.get(membershipKey)
    const projectCause = projectEvidenceCause(projectAttempt, listAttempt, complete)
    if (
      !liveMetadata ||
      !liveList ||
      liveMetadata.completeness.kind !== 'complete' ||
      liveList.completeness.kind !== 'complete'
    ) {
      failures.push({
        integration: project.integration,
        project,
        projectName: metadata?.value.name,
        reason: projectCause || 'Project source membership is incomplete.',
      })
    }
    const open = orderRetainedMaps(key, traceMaps, complete)
    if (complete && liveMetadata && liveList)
      successfulProjectTimes.set(key, Math.max(liveMetadata.observedAt, liveList.observedAt))
    const trace = projectTrace(
      project,
      metadata,
      traceMaps,
      open,
      liveList?.completeness.kind === 'complete' && currentIds.size === 0,
    )
    const current =
      liveMetadata && liveList
        ? {
            ...trace,
            openMaps: orderCurrentMaps(
              currentMaps.filter((map) => map.isOpen),
              open.map((map) => map.id),
            ),
            closedMaps: currentMaps
              .filter((map) => !map.isOpen)
              .sort(
                (a, b) =>
                  (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt) ||
                  a.id.localeCompare(b.id),
              ),
          }
        : undefined
    return {
      trace,
      ...(current ? { current } : {}),
      available: complete,
      cause: projectCause,
      unreachable: failures,
    }
  }
  return {
    commit(committed: CommittedObservation): PublicSourceProjection {
      const registrations = committed.registry.projects.map(projectConfiguredRegistration)
      acceptObservation(committed.observation, registrations)
      const projects = registrations.map((registration): RegisteredProject => {
        const key = projectKey(registration.key)
        const projected = projectedProjects.get(key)
        const known = projected?.trace
        const observed = successfulProjectTimes.get(key)
        const admission = committed.registry.admissions.find((record) =>
          sameProject(projectRefKey(record.intent), registration.key),
        )
        return {
          ...registration,
          name: registration.displayName ?? known?.name ?? registration.key.id,
          availability:
            projected?.available && observed !== undefined
              ? { status: 'available', observedAt: observed }
              : {
                  status: 'unavailable',
                  cause:
                    projected?.cause ?? 'Project has no current successful source observation.',
                  ...(observed === undefined ? {} : { observedAt: observed }),
                },
          openMaps: known?.openMaps ?? [],
          closedMaps: known?.closedMaps ?? [],
          warnings: [
            ...(known?.warnings ?? []),
            ...(admission?.workspace.status === 'unavailable'
              ? [`Workspace unavailable: ${admission.workspace.error.message}`]
              : []),
          ],
          actions: projectActions(registration, admission, known),
        }
      })
      return { roadmap, registrations, projects }
    },
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
  // Refined source health contains only a scope's genuine successful time or its retained
  // last success. Connection freshness is the latest such time among committed owners.
  // Authorization usability and publication time never supply successful source evidence.
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
  // Public degraded health promises retained successful source evidence. A private
  // degradation without that evidence is unavailable, not a fabricated observation.
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
  const key = projectRefKey(intent)
  return {
    key,
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
  known?: Project,
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
      href: known?.sourceUrl ?? `https://github.com/${registration.locator.nameWithOwner}`,
    })
  return actions
}
function projectEvidenceCause(
  project: ObservationAttempt | undefined,
  membership: ObservationAttempt | undefined,
  complete: boolean,
): string {
  if (project?.kind === 'failed') return sourceFailureMessage(project.failure)
  if (membership?.kind === 'failed') return sourceFailureMessage(membership.failure)
  if (project?.kind !== 'observed' || membership?.kind !== 'observed')
    return 'Project has no current successful source observation.'
  return complete ? '' : 'Project source ordering or active map evidence is incomplete.'
}

function projectTrace(
  project: ProjectKey,
  metadata: ObservedProject | undefined,
  maps: WayfinderMap[],
  openMaps: WayfinderMap[],
  emptyMembership: boolean,
): Project {
  const details = metadata?.value
  const warnings = [...(details?.warnings ?? [])]
  if (emptyMembership) warnings.push('No maps found for this project.')
  return {
    key: project,
    name: details?.name ?? project.id,
    openMaps,
    closedMaps: maps
      .filter((map) => !map.isOpen)
      .sort(
        (a, b) =>
          (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt) || a.id.localeCompare(b.id),
      ),
    warnings,
    ...(details?.source.integration === 'local' ? { sourcePath: details.source.path } : {}),
    ...(details?.source.integration === 'github' ? { sourceUrl: details.source.url } : {}),
  }
}

type ObservedSource = Extract<ObservationAttempt, { kind: 'observed' }>
type ObservedMaps = Extract<ObservedSource, { scope: { kind: 'maps-membership' } }>
type ObservedProject = Extract<ObservedSource, { scope: { kind: 'project' } }>

function isObservedScope<K extends SourceScope['kind']>(
  attempt: ObservationAttempt | undefined,
  kind: K,
): attempt is Extract<ObservedSource, { scope: { kind: K } }> {
  return attempt?.kind === 'observed' && attempt.scope.kind === kind
}

function observedProject(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'project') ? attempt : undefined
}

function observedMaps(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'maps-membership') ? attempt : undefined
}

function observedMap(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'map') ? attempt : undefined
}

function observedTickets(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'tickets-membership') ? attempt : undefined
}

function observedTicket(attempt: ObservationAttempt | undefined) {
  return isObservedScope(attempt, 'ticket') ? attempt : undefined
}

function sourceProject(scope: SourceScope): ProjectKey {
  switch (scope.kind) {
    case 'project':
    case 'maps-membership':
      return scope.project
    case 'map':
    case 'tickets-membership':
      return scope.map.project
    case 'ticket':
      return scope.ticket.map.project
  }
}

function sameSourceMap(a: SourceMapKey, b: SourceMapKey): boolean {
  return sameProject(a.project, b.project) && a.mapId === b.mapId
}

function mergeMembers<T>(
  previous: readonly T[],
  next: readonly T[],
  complete: boolean,
  identity: (member: T) => string,
): readonly T[] {
  if (complete) return next
  const members = new Map(previous.map((member) => [identity(member), member]))
  for (const member of next) members.set(identity(member), member)
  return [...members.values()]
}

function orderCurrentMaps(maps: WayfinderMap[], order: readonly string[]): WayfinderMap[] {
  const positions = new Map(order.map((id, index) => [id, index]))
  return maps.sort(
    (a, b) =>
      (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )
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

function projectTicket(ticket: SourceTicketContent, current: boolean): Ticket {
  const blockedBy = ticket.blockedBy.map(projectBlocker)
  const blockersComplete = current && ticket.status !== 'unknown' && ticket.blockersComplete
  const isBlocked = !blockersComplete || blockedBy.some((blocker) => blocker.state !== 'closed')
  const state =
    ticket.status === 'closed'
      ? 'closed'
      : isBlocked
        ? 'blocked'
        : ticket.isClaimed
          ? 'claimed'
          : 'frontier'
  const typeEvidence: Ticket['typeEvidence'] =
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
    id: ticket.key.ticketId,
    ...(ticket.displayId === undefined ? {} : { displayId: ticket.displayId }),
    ...(ticket.title === undefined ? {} : { title: ticket.title }),
    ...(ticket.source.kind === 'issue'
      ? { url: ticket.source.url }
      : { sourcePath: ticket.source.path }),
    body: ticket.body,
    typeEvidence,
    state,
    isClaimed: ticket.isClaimed,
    isBlocked,
    ...(ticket.createdAt === undefined ? {} : { createdAt: ticket.createdAt }),
    ...(ticket.closedAt === undefined ? {} : { closedAt: ticket.closedAt }),
    assignees: ticket.assignees.map((assignee) => ({ ...assignee })),
    blockedBy,
    blockersComplete,
    warnings: [...ticket.warnings],
  }
}

function projectMap(map: SourceMapContent, tickets: Ticket[], current: boolean): WayfinderMap {
  return {
    project: map.key.project,
    id: map.key.mapId,
    ...(map.displayId === undefined ? {} : { displayId: map.displayId }),
    ...(map.title === undefined ? {} : { title: map.title }),
    ...(map.source.kind === 'issue' ? { url: map.source.url } : { sourcePath: map.source.path }),
    isOpen: map.status !== 'closed',
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
    tickets,
    frontier: current ? tickets.filter((ticket) => ticket.state === 'frontier') : [],
    progress: map.progress === null ? null : { ...map.progress },
    ticketsComplete: current,
    warnings: [...map.warnings, ...map.unidentifiedTickets.flatMap((ticket) => ticket.warnings)],
  }
}

function sourceFailureMessage(failure: SourceFailure): string {
  switch (failure.kind) {
    case 'filesystem':
      if (failure.operation === 'inspect-root')
        return failure.code === 'EACCES'
          ? 'Workspace read permission was denied.'
          : 'Workspace cannot be read.'
      return failure.code === 'ENOENT'
        ? 'Source path is currently missing.'
        : failure.code === 'EACCES'
          ? 'Source read permission was denied.'
          : 'Source path cannot be read.'
    case 'transient':
      return failure.cause === 'rate-limit'
        ? 'GitHub rate limit prevents this read.'
        : 'GitHub is temporarily unreachable.'
    case 'execution':
      return 'GitHub could not execute this source read.'
    case 'read':
      return failure.cause === 'response-read'
        ? 'GitHub response could not be read.'
        : 'Source response is malformed.'
    case 'access-unavailable':
      return 'GitHub access is currently unavailable.'
    case 'authorization':
      return 'GitHub authorization is required.'
    case 'access-ambiguous':
      return 'GitHub source is inaccessible; absence is not proven.'
    case 'identity-mismatch':
      return 'GitHub repository identity does not match the admitted Project.'
  }
}
function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
function projectKey(project: ProjectKey): string {
  return `${project.integration}:${project.id}`
}
