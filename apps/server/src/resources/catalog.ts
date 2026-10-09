import type { CommittedObservation, SourceBinding } from '../observation/coordinator.ts'
import {
  type AbsentAttempt,
  type Completeness,
  type ObservationAttempt,
  type SourceFailure,
  type SourceMapKey,
  type SourceProjectKey,
  type SourceProvenance,
  type SourceScope,
  type SourceTicketKey,
  sourceScopeKey,
} from '../observation/source.ts'
import type { ProjectConfigurationIntent } from '../projects/registry.ts'

type Observed = Extract<ObservationAttempt, { kind: 'observed' }>
type ProjectObservation = Extract<Observed, { scope: { kind: 'project' } }>
type MapObservation = Extract<Observed, { scope: { kind: 'map' } }>
type TicketObservation = Extract<Observed, { scope: { kind: 'ticket' } }>
type MapsObservation = Extract<Observed, { scope: { kind: 'maps-membership' } }>
type TicketsObservation = Extract<Observed, { scope: { kind: 'tickets-membership' } }>
type FailedObservation = Extract<ObservationAttempt, { kind: 'failed' }>
type ProjectAbsence = Extract<AbsentAttempt, { scope: { kind: 'project' } }>
type MapAbsence = Extract<AbsentAttempt, { scope: { kind: 'map' } }>
type TicketAbsence = Extract<AbsentAttempt, { scope: { kind: 'ticket' } }>
type Complete<A extends Observed> = A & { readonly completeness: { readonly kind: 'complete' } }

export type UnavailableEvidence =
  | (Omit<FailedObservation, 'kind'> & { readonly kind: 'source-failure'; readonly cause: string })
  | {
      readonly kind: 'incomplete-ancestor'
      readonly scope: SourceScope
      readonly readSequence: number
      readonly attemptedAt: number
      readonly observedAt: number
      readonly provenance: SourceProvenance
      readonly completeness: Extract<Completeness, { kind: 'incomplete' }>
      readonly cause: string
    }
  | {
      readonly kind: 'no-current-evidence'
      readonly scope: SourceScope
      readonly readSequence: number | null
      readonly cause: string
    }

type ResourceResult<A extends Observed, P extends AbsentAttempt> =
  | {
      readonly kind: 'never-observed'
      readonly scope: A['scope']
      readonly current: UnavailableEvidence | null
    }
  | { readonly kind: 'current-readable'; readonly observation: A }
  | {
      readonly kind: 'retained-unavailable'
      readonly lastSuccessful: A
      readonly unavailable: UnavailableEvidence
    }
  | {
      readonly kind: 'proven-absent'
      readonly absence: P
      readonly trace:
        | { readonly kind: 'no-known-trace' }
        | { readonly kind: 'last-successful-trace'; readonly lastSuccessful: A }
    }

export type ProjectResourceResult = ResourceResult<ProjectObservation, ProjectAbsence>
export type MapResourceResult = ResourceResult<MapObservation, MapAbsence>
export type TicketResourceResult = ResourceResult<TicketObservation, TicketAbsence>
type MembershipState<A extends MapsObservation | TicketsObservation> =
  | { readonly kind: 'never-observed'; readonly current: UnavailableEvidence | null }
  | { readonly kind: 'current-complete'; readonly observation: Complete<A> }
  | {
      readonly kind: 'current-incomplete'
      readonly observation: A & {
        readonly completeness: Extract<Completeness, { kind: 'incomplete' }>
      }
      readonly lastComplete: Complete<A> | null
    }
  | {
      readonly kind: 'unavailable'
      readonly unavailable: UnavailableEvidence
      readonly lastComplete: Complete<A> | null
    }

type ObservationMetadata<A extends Observed> = Omit<A, 'kind' | 'value'>
type CompleteMetadata<A extends Observed> = ObservationMetadata<Complete<A>>
interface OrderingEvidence {
  readonly project: CompleteMetadata<ProjectObservation>
  readonly membership: CompleteMetadata<MapsObservation>
  readonly maps: readonly {
    readonly mapId: string
    readonly observation: CompleteMetadata<MapObservation>
    readonly ticketsMembership: CompleteMetadata<TicketsObservation>
    readonly tickets: readonly {
      readonly ticketId: string
      readonly observation: CompleteMetadata<TicketObservation>
    }[]
  }[]
}
type KnownCurrentOrder = {
  readonly kind: 'known-current'
  readonly mapId: string
  readonly orderedMapIds: readonly string[]
  readonly evidence: OrderingEvidence
}
type KnownEmptyOrder = { readonly kind: 'known-empty'; readonly evidence: OrderingEvidence }
type ActiveMapResult =
  | KnownCurrentOrder
  | KnownEmptyOrder
  | {
      readonly kind: 'uncertain'
      readonly lastKnown: { readonly kind: 'none' } | KnownCurrentOrder | KnownEmptyOrder
      readonly reason:
        | 'never-observed'
        | 'project-unavailable'
        | 'membership-unavailable'
        | 'membership-incomplete'
        | 'map-unavailable'
        | 'map-incomplete'
        | 'map-status-unknown'
      readonly cause: string
    }

export interface ResourceCatalogSnapshot {
  readonly committed: CommittedObservation
  readonly projects: readonly CatalogProject[]
}
export interface CatalogProject {
  readonly key: SourceProjectKey
  readonly intent: ProjectConfigurationIntent
  readonly resource: ProjectResourceResult
  readonly mapsMembership: MembershipState<MapsObservation>
  readonly maps: readonly CatalogMap[]
  readonly displayOrder: {
    readonly openMapIds: readonly string[]
    readonly closedMapIds: readonly string[]
  }
  readonly activeMap: ActiveMapResult
}
export interface CatalogMap {
  readonly key: SourceMapKey
  readonly resource: MapResourceResult
  readonly ticketsMembership: MembershipState<TicketsObservation>
  readonly tickets: readonly CatalogTicket[]
}
export interface CatalogTicket {
  readonly key: SourceTicketKey
  readonly resource: TicketResourceResult
}

interface ResourceRecord<A extends Observed, P extends AbsentAttempt> {
  readonly scope: A['scope']
  lastSuccessful: A | null
  absence: P | null
  lastReadSequence: number | null
  lastFailureSequence: number | null
  lastMembershipPresenceSequence: number | null
  readable: boolean
  readableBarrier: number | null
}
interface MembershipRecord<A extends MapsObservation | TicketsObservation> {
  readonly scope: A['scope']
  lastObserved: A | null
  lastComplete: Complete<A> | null
  lastCompleteReadSequence: number | null
  lastFailureSequence: number | null
  readable: boolean
  readableBarrier: number | null
}
interface ProjectRecord {
  readonly key: SourceProjectKey
  binding: SourceBinding
  readonly resource: ResourceRecord<ProjectObservation, ProjectAbsence>
  readonly membership: MembershipRecord<MapsObservation>
  readonly maps: Map<string, MapRecord>
  displayOrder: CatalogProject['displayOrder']
  lastKnown: { readonly kind: 'none' } | KnownCurrentOrder | KnownEmptyOrder
}
interface MapRecord {
  readonly key: SourceMapKey
  readonly resource: ResourceRecord<MapObservation, MapAbsence>
  readonly membership: MembershipRecord<TicketsObservation>
  readonly tickets: Map<string, ResourceRecord<TicketObservation, TicketAbsence>>
}

/** One owner for current evidence, historical trace, membership and trustworthy order. */
export class ResourceCatalog {
  private readonly records = new Map<string, ProjectRecord>()
  private snapshot: ResourceCatalogSnapshot | null = null

  current(): ResourceCatalogSnapshot | null {
    return this.snapshot
  }

  commit(committed: CommittedObservation): ResourceCatalogSnapshot {
    const projects: CatalogProject[] = []
    for (const intent of committed.registry.projects) {
      const key: SourceProjectKey = {
        integration: intent.ref.integration,
        id: intent.ref.projectId,
      }
      const scope = { kind: 'project', project: key } satisfies SourceScope
      const index = sourceScopeKey(scope)
      const binding = committed.sourceBindings.get(JSON.stringify([key.integration, key.id]))
      if (!binding) throw new Error('Committed Project has no source binding.')
      let record = this.records.get(index)
      if (!record) {
        record = {
          key,
          binding,
          resource: resourceRecord<ProjectObservation, ProjectAbsence>(scope),
          membership: membershipRecord<MapsObservation>({ kind: 'maps-membership', project: key }),
          maps: new Map(),
          displayOrder: { openMapIds: [], closedMapIds: [] },
          lastKnown: { kind: 'none' },
        }
        this.records.set(index, record)
      }
      if (record.binding !== binding) {
        record.binding = binding
        resetProjectAuthority(record)
      }
      const attempts = new Map<string, ObservationAttempt>()
      for (const attempt of committed.observation.attempts) {
        if (!sameProject(scopeProject(attempt.scope), key) || !matchesBinding(attempt, intent))
          continue
        const attemptKey = sourceScopeKey(attempt.scope)
        const previous = attempts.get(attemptKey)
        // An unnamed malformed Local ticket adds a scoped failure beside the actual list.
        // Keep that failure as the collection's current evidence rather than certify completeness.
        if (!previous || attempt.readSequence >= previous.readSequence)
          attempts.set(attemptKey, attempt)
        encounter(record, attempt)
      }
      const projectAttempt = attempts.get(index)
      const resource = mergeResource(
        record.resource,
        observedScope(projectAttempt, 'project'),
        failed(projectAttempt),
        absentScope(projectAttempt, 'project'),
        null,
      )
      const projectUnavailable = resourceUnavailable(resource)
      const listAttempt = attempts.get(sourceScopeKey(record.membership.scope))
      const mapsMembership = mergeMembership(
        record.membership,
        observedScope(listAttempt, 'maps-membership'),
        failed(listAttempt),
        projectUnavailable,
      )
      const mapAncestor = newestUnavailable(
        projectUnavailable,
        membershipUnavailable(mapsMembership, record.membership.scope),
      )
      const maps: CatalogMap[] = []
      for (const mapRecord of record.maps.values()) {
        const mapAttempt = attempts.get(sourceScopeKey(mapRecord.resource.scope))
        const mapAbsence = membershipMapAbsence(mapsMembership, mapRecord.key)
        const mapResource = mergeResource(
          mapRecord.resource,
          observedScope(mapAttempt, 'map'),
          failed(mapAttempt),
          newestAbsence(absentScope(mapAttempt, 'map'), mapAbsence),
          mapAncestor,
          membershipMapPresence(mapsMembership, mapRecord.key),
        )
        const ticketListAttempt = attempts.get(sourceScopeKey(mapRecord.membership.scope))
        const ticketsMembership = mergeMembership(
          mapRecord.membership,
          observedScope(ticketListAttempt, 'tickets-membership'),
          failed(ticketListAttempt),
          newestUnavailable(mapAncestor, resourceUnavailable(mapResource)),
        )
        const ticketAncestor = newestUnavailable(
          newestUnavailable(mapAncestor, resourceUnavailable(mapResource)),
          membershipUnavailable(ticketsMembership, mapRecord.membership.scope),
        )
        const tickets: CatalogTicket[] = []
        for (const ticketRecord of mapRecord.tickets.values()) {
          const ticketAttempt = attempts.get(sourceScopeKey(ticketRecord.scope))
          const ticketAbsence = membershipTicketAbsence(
            ticketsMembership,
            ticketRecord.scope.ticket,
          )
          tickets.push({
            key: ticketRecord.scope.ticket,
            resource: mergeResource(
              ticketRecord,
              observedScope(ticketAttempt, 'ticket'),
              failed(ticketAttempt),
              newestAbsence(absentScope(ticketAttempt, 'ticket'), ticketAbsence),
              ticketAncestor,
              membershipTicketPresence(ticketsMembership, ticketRecord.scope.ticket),
            ),
          })
        }
        maps.push({ key: mapRecord.key, resource: mapResource, ticketsMembership, tickets })
      }
      const ordering = establishOrder(resource, mapsMembership, maps, record.lastKnown)
      if (ordering.activeMap.kind !== 'uncertain') {
        record.lastKnown = ordering.activeMap
        record.displayOrder = ordering.displayOrder
      }
      projects.push({
        key: record.key,
        intent,
        resource,
        mapsMembership,
        maps,
        displayOrder: record.displayOrder,
        activeMap: ordering.activeMap,
      })
    }
    this.snapshot = { committed, projects }
    return this.snapshot
  }
}

function resourceRecord<A extends Observed, P extends AbsentAttempt>(
  scope: A['scope'],
): ResourceRecord<A, P> {
  return {
    scope,
    lastSuccessful: null,
    absence: null,
    lastReadSequence: null,
    lastFailureSequence: null,
    lastMembershipPresenceSequence: null,
    readable: false,
    readableBarrier: null,
  }
}
function membershipRecord<A extends MapsObservation | TicketsObservation>(
  scope: A['scope'],
): MembershipRecord<A> {
  return {
    scope,
    lastObserved: null,
    lastComplete: null,
    lastCompleteReadSequence: null,
    lastFailureSequence: null,
    readable: false,
    readableBarrier: null,
  }
}
function resetProjectAuthority(project: ProjectRecord): void {
  resetResourceAuthority(project.resource)
  resetMembershipAuthority(project.membership)
  for (const map of project.maps.values()) {
    resetResourceAuthority(map.resource)
    resetMembershipAuthority(map.membership)
    for (const ticket of map.tickets.values()) resetResourceAuthority(ticket)
  }
}
function resetResourceAuthority<A extends Observed, P extends AbsentAttempt>(
  record: ResourceRecord<A, P>,
): void {
  record.absence = null
  record.lastReadSequence = null
  record.lastFailureSequence = null
  record.lastMembershipPresenceSequence = null
  record.readable = false
  record.readableBarrier = null
}
function resetMembershipAuthority<A extends MapsObservation | TicketsObservation>(
  record: MembershipRecord<A>,
): void {
  record.lastObserved = null
  record.lastCompleteReadSequence = null
  record.lastFailureSequence = null
  record.readable = false
  record.readableBarrier = null
}
function encounter(project: ProjectRecord, attempt: ObservationAttempt): void {
  const maps = observedScope(attempt, 'maps-membership')
  if (maps) for (const key of maps.value.members) ensureMap(project, key)
  const scope = attempt.scope
  if (scope.kind === 'map' || scope.kind === 'tickets-membership') ensureMap(project, scope.map)
  if (scope.kind === 'ticket') ensureTicket(ensureMap(project, scope.ticket.map), scope.ticket)
  const tickets = observedScope(attempt, 'tickets-membership')
  if (tickets)
    for (const key of tickets.value.members) ensureTicket(ensureMap(project, key.map), key)
}
function ensureMap(project: ProjectRecord, key: SourceMapKey): MapRecord {
  const scope = { kind: 'map', map: key } satisfies SourceScope
  const index = sourceScopeKey(scope)
  let record = project.maps.get(index)
  if (!record) {
    record = {
      key,
      resource: resourceRecord<MapObservation, MapAbsence>(scope),
      membership: membershipRecord<TicketsObservation>({ kind: 'tickets-membership', map: key }),
      tickets: new Map(),
    }
    project.maps.set(index, record)
  }
  return record
}
function ensureTicket(map: MapRecord, key: SourceTicketKey): void {
  const scope = { kind: 'ticket', ticket: key } satisfies SourceScope
  const index = sourceScopeKey(scope)
  if (!map.tickets.has(index))
    map.tickets.set(index, resourceRecord<TicketObservation, TicketAbsence>(scope))
}

function mergeResource<A extends Observed, P extends AbsentAttempt>(
  record: ResourceRecord<A, P>,
  observation: A | undefined,
  failure: FailedObservation | undefined,
  absence: P | undefined,
  inherited: UnavailableEvidence | null,
  membershipPresence?: MapsObservation | TicketsObservation,
): ResourceResult<A, P> {
  const advanced =
    observation !== undefined &&
    (record.lastReadSequence === null || observation.readSequence > record.lastReadSequence)
  if (
    observation &&
    (record.lastReadSequence === null || observation.readSequence >= record.lastReadSequence)
  ) {
    // Equal identity may correct cached interpretation, but does not authorize a read.
    record.lastSuccessful = observation
    record.lastReadSequence = observation.readSequence
  }
  if (failure)
    record.lastFailureSequence = Math.max(record.lastFailureSequence ?? 0, failure.readSequence)
  if (
    absence &&
    (record.lastReadSequence === null || absence.readSequence >= record.lastReadSequence) &&
    (!record.absence || absence.readSequence >= record.absence.readSequence)
  )
    record.absence = absence
  if (membershipPresence)
    record.lastMembershipPresenceSequence = Math.max(
      record.lastMembershipPresenceSequence ?? 0,
      membershipPresence.readSequence,
    )
  // Preserve the absence read barrier after membership-only reappearance.
  if (
    record.absence &&
    (record.lastReadSequence === null || record.lastReadSequence <= record.absence.readSequence) &&
    (record.lastMembershipPresenceSequence === null ||
      record.lastMembershipPresenceSequence <= record.absence.readSequence)
  ) {
    record.readable = false
    return {
      kind: 'proven-absent',
      absence: record.absence,
      trace: record.lastSuccessful
        ? { kind: 'last-successful-trace', lastSuccessful: record.lastSuccessful }
        : { kind: 'no-known-trace' },
    }
  }
  const currentFailure =
    failure && failure.readSequence >= (record.lastReadSequence ?? 0) ? failure : undefined
  const unavailable = newestUnavailable(
    currentFailure ? failureEvidence(currentFailure) : null,
    inherited,
  )
  const barrier = unavailable?.readSequence ?? null
  const ownIsLatest =
    record.lastReadSequence !== null &&
    (!record.absence || record.lastReadSequence > record.absence.readSequence) &&
    (record.lastFailureSequence === null || record.lastReadSequence > record.lastFailureSequence)
  if (advanced && ownIsLatest) {
    record.readable = true
    record.readableBarrier = barrier
  } else if (
    barrier !== null &&
    barrier > Math.max(record.lastReadSequence ?? 0, record.readableBarrier ?? 0)
  ) {
    record.readable = false
  }
  if (!observation && !failure && !absence) record.readable = false
  if (record.lastSuccessful && ownIsLatest && record.readable)
    return { kind: 'current-readable', observation: record.lastSuccessful }
  const evidence = unavailable ?? noCurrent(record.scope)
  return record.lastSuccessful
    ? { kind: 'retained-unavailable', lastSuccessful: record.lastSuccessful, unavailable: evidence }
    : { kind: 'never-observed', scope: record.scope, current: evidence }
}
function mergeMembership<A extends MapsObservation | TicketsObservation>(
  record: MembershipRecord<A>,
  observation: A | undefined,
  failure: FailedObservation | undefined,
  inherited: UnavailableEvidence | null,
): MembershipState<A> {
  const advanced =
    observation !== undefined &&
    (!record.lastObserved || observation.readSequence > record.lastObserved.readSequence)
  if (
    observation &&
    (!record.lastObserved || observation.readSequence >= record.lastObserved.readSequence)
  ) {
    record.lastObserved = observation
    if (
      record.lastCompleteReadSequence === observation.readSequence &&
      observation.completeness.kind === 'complete'
    )
      record.lastComplete = { ...observation, completeness: observation.completeness }
  }
  if (failure)
    record.lastFailureSequence = Math.max(record.lastFailureSequence ?? 0, failure.readSequence)
  const currentFailure =
    failure && failure.readSequence >= (record.lastObserved?.readSequence ?? 0)
      ? failure
      : undefined
  const unavailable = newestUnavailable(
    currentFailure ? failureEvidence(currentFailure) : null,
    inherited,
  )
  const barrier = unavailable?.readSequence ?? null
  const ownIsLatest =
    record.lastObserved !== null &&
    (record.lastFailureSequence === null ||
      record.lastObserved.readSequence > record.lastFailureSequence)
  if (advanced && ownIsLatest) {
    record.readable = true
    record.readableBarrier = barrier
  } else if (
    barrier !== null &&
    barrier > Math.max(record.lastObserved?.readSequence ?? 0, record.readableBarrier ?? 0)
  ) {
    record.readable = false
  }
  if (!observation && !failure) record.readable = false
  if (record.lastObserved && ownIsLatest && record.readable) {
    const current = record.lastObserved
    if (current.completeness.kind === 'complete') {
      const complete = { ...current, completeness: current.completeness }
      record.lastComplete = complete
      record.lastCompleteReadSequence = current.readSequence
      return { kind: 'current-complete', observation: complete }
    }
    return {
      kind: 'current-incomplete',
      observation: { ...current, completeness: current.completeness },
      lastComplete: record.lastComplete,
    }
  }
  if (!observation && !failure && !inherited && !record.lastObserved)
    return { kind: 'never-observed', current: null }
  return {
    kind: 'unavailable',
    unavailable: unavailable ?? noCurrent(record.scope),
    lastComplete: record.lastComplete,
  }
}
function newestAbsence<P extends AbsentAttempt>(a: P | undefined, b: P | undefined): P | undefined {
  return !a || (b && b.readSequence >= a.readSequence) ? b : a
}
function failureEvidence(failure: FailedObservation): UnavailableEvidence {
  return { ...failure, kind: 'source-failure', cause: sourceFailureMessage(failure.failure) }
}
function noCurrent(scope: SourceScope, readSequence: number | null = null): UnavailableEvidence {
  return {
    kind: 'no-current-evidence',
    scope,
    readSequence,
    cause: 'No current source observation is available.',
  }
}
function resourceUnavailable<A extends Observed, P extends AbsentAttempt>(
  resource: ResourceResult<A, P>,
): UnavailableEvidence | null {
  switch (resource.kind) {
    case 'never-observed':
      return resource.current
    case 'retained-unavailable':
      return resource.unavailable
    case 'proven-absent':
      return noCurrent(resource.absence.scope, resource.absence.readSequence)
    case 'current-readable':
      return incompleteEvidence(resource.observation)
  }
}
function membershipUnavailable<A extends MapsObservation | TicketsObservation>(
  membership: MembershipState<A>,
  scope: A['scope'],
): UnavailableEvidence | null {
  switch (membership.kind) {
    case 'never-observed':
      return membership.current ?? noCurrent(scope)
    case 'unavailable':
      return membership.unavailable
    case 'current-incomplete':
      return incompleteEvidence(membership.observation)
    case 'current-complete':
      return null
  }
}
function incompleteEvidence(observation: Observed): UnavailableEvidence | null {
  return observation.completeness.kind === 'complete'
    ? null
    : {
        kind: 'incomplete-ancestor',
        scope: observation.scope,
        readSequence: observation.readSequence,
        attemptedAt: observation.attemptedAt,
        observedAt: observation.observedAt,
        provenance: observation.provenance,
        completeness: observation.completeness,
        cause: 'Current ancestor source evidence is incomplete.',
      }
}
function newestUnavailable(
  a: UnavailableEvidence | null,
  b: UnavailableEvidence | null,
): UnavailableEvidence | null {
  if (!a) return b
  if (!b) return a
  const aSequence = a.readSequence ?? 0
  const bSequence = b.readSequence ?? 0
  return bSequence > aSequence ||
    (bSequence === aSequence && b.kind === 'source-failure' && a.kind !== 'source-failure')
    ? b
    : a
}
function membershipMapPresence(
  membership: MembershipState<MapsObservation>,
  key: SourceMapKey,
): MapsObservation | undefined {
  return (membership.kind === 'current-complete' || membership.kind === 'current-incomplete') &&
    membership.observation.value.members.some((member) => member.mapId === key.mapId)
    ? membership.observation
    : undefined
}
function membershipTicketPresence(
  membership: MembershipState<TicketsObservation>,
  key: SourceTicketKey,
): TicketsObservation | undefined {
  return (membership.kind === 'current-complete' || membership.kind === 'current-incomplete') &&
    membership.observation.value.members.some((member) => member.ticketId === key.ticketId)
    ? membership.observation
    : undefined
}
function membershipMapAbsence(
  membership: MembershipState<MapsObservation>,
  key: SourceMapKey,
): MapAbsence | undefined {
  if (
    membership.kind !== 'current-complete' ||
    membership.observation.value.members.some((member) => member.mapId === key.mapId)
  )
    return undefined
  const observation = membership.observation
  return {
    kind: 'proven-absent',
    scope: { kind: 'map', map: key },
    readSequence: observation.readSequence,
    attemptedAt: observation.attemptedAt,
    observedAt: observation.observedAt,
    provenance: observation.provenance,
    proof: { kind: 'complete-membership', parent: observation.scope },
  }
}
function membershipTicketAbsence(
  membership: MembershipState<TicketsObservation>,
  key: SourceTicketKey,
): TicketAbsence | undefined {
  if (
    membership.kind !== 'current-complete' ||
    membership.observation.value.members.some((member) => member.ticketId === key.ticketId)
  )
    return undefined
  const observation = membership.observation
  return {
    kind: 'proven-absent',
    scope: { kind: 'ticket', ticket: key },
    readSequence: observation.readSequence,
    attemptedAt: observation.attemptedAt,
    observedAt: observation.observedAt,
    provenance: observation.provenance,
    proof: { kind: 'complete-membership', parent: observation.scope },
  }
}

function establishOrder(
  resource: ProjectResourceResult,
  membership: MembershipState<MapsObservation>,
  maps: readonly CatalogMap[],
  lastKnown: ProjectRecord['lastKnown'],
): { activeMap: ActiveMapResult; displayOrder: CatalogProject['displayOrder'] } {
  function uncertain(reason: Extract<ActiveMapResult, { kind: 'uncertain' }>['reason']) {
    return {
      activeMap: {
        kind: 'uncertain',
        reason,
        cause: uncertaintyCause(reason),
        lastKnown,
      } satisfies ActiveMapResult,
      displayOrder: { openMapIds: [], closedMapIds: [] },
    }
  }
  if (resource.kind !== 'current-readable')
    return uncertain(
      lastKnown.kind === 'none' && resource.kind === 'never-observed'
        ? 'never-observed'
        : 'project-unavailable',
    )
  if (resource.observation.completeness.kind !== 'complete') return uncertain('project-unavailable')
  if (membership.kind === 'current-incomplete') return uncertain('membership-incomplete')
  if (membership.kind !== 'current-complete') return uncertain('membership-unavailable')
  const currentMaps: { key: SourceMapKey; observation: Complete<MapObservation> }[] = []
  const mapEvidence: OrderingEvidence['maps'][number][] = []
  for (const member of membership.observation.value.members) {
    const map = maps.find((candidate) => candidate.key.mapId === member.mapId)
    if (!map || map.resource.kind !== 'current-readable') return uncertain('map-unavailable')
    const observation = map.resource.observation
    if (observation.completeness.kind !== 'complete' || observation.value.progress === null)
      return uncertain('map-incomplete')
    if (observation.value.status === 'unknown') return uncertain('map-status-unknown')
    if (map.ticketsMembership.kind !== 'current-complete') return uncertain('map-incomplete')
    const tickets: OrderingEvidence['maps'][number]['tickets'][number][] = []
    for (const ticketMember of map.ticketsMembership.observation.value.members) {
      const ticket = map.tickets.find(
        (candidate) => candidate.key.ticketId === ticketMember.ticketId,
      )
      if (!ticket || ticket.resource.kind !== 'current-readable') return uncertain('map-incomplete')
      const ticketObservation = ticket.resource.observation
      if (
        ticketObservation.completeness.kind !== 'complete' ||
        ticketObservation.value.status === 'unknown' ||
        !ticketObservation.value.blockersComplete ||
        ticketObservation.value.blockedBy.some((blocker) => blocker.state === 'unknown')
      )
        return uncertain('map-incomplete')
      tickets.push({
        ticketId: ticketMember.ticketId,
        observation: completeMetadata({
          ...ticketObservation,
          completeness: ticketObservation.completeness,
        }),
      })
    }
    const complete = { ...observation, completeness: observation.completeness }
    currentMaps.push({ key: map.key, observation: complete })
    mapEvidence.push({
      mapId: map.key.mapId,
      observation: completeMetadata(complete),
      ticketsMembership: completeMetadata(map.ticketsMembership.observation),
      tickets,
    })
  }
  const evidence: OrderingEvidence = {
    project: completeMetadata({
      ...resource.observation,
      completeness: resource.observation.completeness,
    }),
    membership: completeMetadata(membership.observation),
    maps: mapEvidence,
  }
  const openMapIds = currentMaps
    .filter((map) => map.observation.value.status === 'open')
    .sort(
      (a, b) =>
        b.observation.value.updatedAt - a.observation.value.updatedAt ||
        (a.key.mapId < b.key.mapId ? -1 : a.key.mapId > b.key.mapId ? 1 : 0),
    )
    .map((map) => map.key.mapId)
  const closedMapIds = currentMaps
    .filter((map) => map.observation.value.status === 'closed')
    .sort(
      (a, b) =>
        (b.observation.value.closedAt ?? b.observation.value.updatedAt) -
          (a.observation.value.closedAt ?? a.observation.value.updatedAt) ||
        (a.key.mapId < b.key.mapId ? -1 : a.key.mapId > b.key.mapId ? 1 : 0),
    )
    .map((map) => map.key.mapId)
  const first = openMapIds[0]
  return {
    activeMap:
      first === undefined
        ? { kind: 'known-empty', evidence }
        : { kind: 'known-current', mapId: first, orderedMapIds: openMapIds, evidence },
    displayOrder: { openMapIds, closedMapIds },
  }
}
function completeMetadata<A extends Observed>(observation: Complete<A>): CompleteMetadata<A> {
  const { kind: _kind, value: _value, ...metadata } = observation
  return metadata
}
function uncertaintyCause(
  reason: Extract<ActiveMapResult, { kind: 'uncertain' }>['reason'],
): string {
  switch (reason) {
    case 'never-observed':
      return 'Active map has never been established.'
    case 'project-unavailable':
      return 'Project source is currently unavailable.'
    case 'membership-unavailable':
      return 'Map membership is currently unavailable.'
    case 'membership-incomplete':
      return 'Map membership is incomplete.'
    case 'map-unavailable':
      return 'A map required for ordering is currently unavailable.'
    case 'map-incomplete':
      return 'A map required for ordering is incomplete.'
    case 'map-status-unknown':
      return 'A map required for ordering has unknown status.'
  }
}
function isObservedScope<K extends SourceScope['kind']>(
  attempt: ObservationAttempt | undefined,
  kind: K,
): attempt is Extract<Observed, { scope: { kind: K } }> {
  return attempt?.kind === 'observed' && attempt.scope.kind === kind
}
function observedScope<K extends SourceScope['kind']>(
  attempt: ObservationAttempt | undefined,
  kind: K,
) {
  return isObservedScope(attempt, kind) ? attempt : undefined
}
function isAbsentScope<K extends 'project' | 'map' | 'ticket'>(
  attempt: ObservationAttempt | undefined,
  kind: K,
): attempt is Extract<AbsentAttempt, { scope: { kind: K } }> {
  return attempt?.kind === 'proven-absent' && attempt.scope.kind === kind
}
function absentScope<K extends 'project' | 'map' | 'ticket'>(
  attempt: ObservationAttempt | undefined,
  kind: K,
) {
  return isAbsentScope(attempt, kind) ? attempt : undefined
}
function failed(attempt: ObservationAttempt | undefined): FailedObservation | undefined {
  return attempt?.kind === 'failed' ? attempt : undefined
}
function scopeProject(scope: SourceScope): SourceProjectKey {
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
function sameProject(a: SourceProjectKey, b: SourceProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
function matchesBinding(attempt: ObservationAttempt, intent: ProjectConfigurationIntent): boolean {
  const provenance = attempt.provenance
  if ('locator' in intent)
    return (
      provenance.integration === 'github' &&
      provenance.connectionId === intent.connectionId &&
      provenance.repositoryId === intent.locator.repositoryId
    )
  if (provenance.integration !== 'local') return false
  const root = intent.workspace.path
  return provenance.path === root || provenance.path.startsWith(root === '/' ? '/' : `${root}/`)
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
