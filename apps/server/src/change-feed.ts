import type {
  ObservationAttempt,
  SourceProjectKey as ProjectKey,
  SourceMapKey,
  SourceScope,
  SourceTicketContent,
  SourceTicketKey,
} from './observation/source.ts'

/** A ticket named by an event, carrying its map so subscribers need no lookup. */
export interface EventTicket {
  project: ProjectKey
  projectName: string
  mapId: string
  mapDisplayId?: string
  mapTitle?: string
  id: string
  displayId?: string
  title?: string
  url?: string
}

/** A map named by an event. */
interface EventMap {
  project: ProjectKey
  projectName: string
  id: string
  displayId?: string
  title?: string
  url?: string
}

/** Observation mechanisms are invisible to event consumers. */
export type ChangeEvent =
  | { type: 'map-appeared'; map: EventMap }
  | { type: 'ticket-claimed'; ticket: EventTicket }
  | { type: 'ticket-closed'; ticket: EventTicket }
  | { type: 'frontier-changed'; map: EventMap; entered: EventTicket[]; left: EventTicket[] }

/** Committed source evidence and presentation only, never public read authority. */
export interface ChangeFeedInput {
  readonly attempts: readonly ObservationAttempt[]
  readonly projects: readonly { readonly key: ProjectKey; readonly name: string }[]
  readonly baselineProjects: readonly ProjectKey[]
  /** Scoped presentation order has no presence or transition authority. */
  readonly order: readonly { readonly map: SourceMapKey; readonly tickets: readonly string[] }[]
}

export interface ChangeFeed {
  /** One batch per committed input with activity. Appearances precede transitions and frontier deltas. */
  onEvent(listener: (events: ChangeEvent[]) => void): () => void
  stop(): void
}

interface ChangeFeedSource {
  onChange(listener: (input: ChangeFeedInput) => void): () => void
}

interface TicketComparison {
  subject: EventTicket
  present: boolean
  status: SourceTicketContent['status']
  isClaimed: boolean
  frontier: boolean | undefined
}

interface MapComparison {
  subject: EventMap
  present: boolean
  appearancePending: boolean
  ticketsMembershipKnown: boolean
  tickets: Map<string, TicketComparison>
}

interface ProjectComparison {
  key: ProjectKey
  membershipKnown: boolean
}

/** Borrowed scope and accumulated events live only for one committed input. */
interface ComparisonFrame {
  initial: boolean
  baseline: Set<string>
  configured: Map<string, ChangeFeedInput['projects'][number]>
  mapAppearances: Extract<ChangeEvent, { type: 'map-appeared' }>[]
  transitions: Extract<ChangeEvent, { type: 'ticket-claimed' | 'ticket-closed' }>[]
  frontiers: Map<string, Extract<ChangeEvent, { type: 'frontier-changed' }>>
  seenTransitions: Set<string>
  absentProjects: Set<string>
  absentMaps: Set<string>
  absentTickets: Set<string>
  newMaps: Set<string>
}

/**
 * Keeps only notification comparison evidence. Failed or omitted scopes do not erase it.
 * An unknown first membership establishes a quiet baseline, not an empty success.
 */
export function createChangeFeed(source: ChangeFeedSource): ChangeFeed {
  const listeners = new Set<(events: ChangeEvent[]) => void>()
  const projects = new Map<string, ProjectComparison>()
  const maps = new Map<string, MapComparison>()
  let initialized = false

  function prepareFrame(input: ChangeFeedInput): ComparisonFrame {
    const baseline = new Set(input.baselineProjects.map(keyedProject))
    const configured = new Map(
      input.projects.map((project) => [keyedProject(project.key), project]),
    )
    for (const [key] of projects) {
      if (!configured.has(key) || baseline.has(key)) projects.delete(key)
    }
    for (const [key, map] of maps) {
      const project = keyedProject(map.subject.project)
      if (!configured.has(project) || baseline.has(project)) maps.delete(key)
    }
    for (const [key, project] of configured) {
      if (!projects.has(key)) projects.set(key, { key: project.key, membershipKnown: false })
    }
    for (const map of maps.values()) {
      const name = configured.get(keyedProject(map.subject.project))?.name
      if (name === undefined) continue
      map.subject = { ...map.subject, projectName: name }
      for (const ticket of map.tickets.values())
        ticket.subject = { ...ticket.subject, projectName: name }
    }
    return {
      initial: !initialized,
      baseline,
      configured,
      mapAppearances: [],
      transitions: [],
      frontiers: new Map(),
      seenTransitions: new Set(),
      absentProjects: new Set(),
      absentMaps: new Set(),
      absentTickets: new Set(),
      newMaps: new Set(),
    }
  }

  function retainPresentMap(frame: ComparisonFrame, key: SourceMapKey): MapComparison | undefined {
    const project = projects.get(keyedProject(key.project))
    if (!project || frame.absentProjects.has(keyedProject(key.project))) return undefined
    const id = keyedMap(key.project, key.mapId)
    if (frame.absentMaps.has(id)) return undefined
    let map = maps.get(id)
    if (!map) {
      map = {
        subject: {
          project: key.project,
          projectName: frame.configured.get(keyedProject(key.project))?.name ?? key.project.id,
          id: key.mapId,
        },
        present: true,
        appearancePending: project.membershipKnown,
        ticketsMembershipKnown: false,
        tickets: new Map(),
      }
      maps.set(id, map)
      frame.newMaps.add(id)
    } else if (!map.present) {
      map.present = true
      map.appearancePending = true
      frame.newMaps.add(id)
    }
    return map
  }

  function leaveFrontier(
    frame: ComparisonFrame,
    map: MapComparison,
    ticket: TicketComparison,
  ): void {
    if (ticket.frontier === true) frontierChange(frame, map).left.push(ticket.subject)
    ticket.present = false
    ticket.status = 'unknown'
    ticket.isClaimed = false
    ticket.frontier = false
  }

  // Explicit absence wins over positive evidence for the same scope in this frame.
  function recordExplicitAbsence(
    frame: ComparisonFrame,
    attempts: readonly ObservationAttempt[],
  ): void {
    for (const attempt of attempts) {
      if (attempt.kind !== 'proven-absent') continue
      switch (attempt.scope.kind) {
        case 'project': {
          const key = keyedProject(attempt.scope.project)
          frame.absentProjects.add(key)
          const project = projects.get(key)
          if (project) project.membershipKnown = true
          for (const map of maps.values()) {
            if (keyedProject(map.subject.project) === key) removeMap(map)
          }
          break
        }
        case 'map': {
          const key = keyedMap(attempt.scope.map.project, attempt.scope.map.mapId)
          frame.absentMaps.add(key)
          const map = maps.get(key)
          if (map) removeMap(map)
          break
        }
        case 'ticket':
          frame.absentTickets.add(keyedScopedTicket(attempt.scope.ticket))
          break
      }
    }
  }

  // Incomplete membership establishes presence only. Complete membership also proves absence.
  function reconcileMapMembership(
    frame: ComparisonFrame,
    attempts: readonly ObservationAttempt[],
  ): void {
    for (const attempt of attempts) {
      if (!isObservedScope(attempt, 'maps-membership')) continue
      const project = projects.get(keyedProject(attempt.scope.project))
      if (!project || frame.absentProjects.has(keyedProject(project.key))) continue
      for (const member of attempt.value.members) retainPresentMap(frame, member)
      if (attempt.completeness.kind !== 'complete') continue
      const members = new Set(attempt.value.members.map((map) => keyedMap(map.project, map.mapId)))
      for (const [key, map] of maps) {
        if (keyedProject(map.subject.project) !== keyedProject(project.key) || members.has(key))
          continue
        frame.absentMaps.add(key)
        removeMap(map)
      }
      project.membershipKnown = true
    }
  }

  function observeMapSubjects(
    frame: ComparisonFrame,
    attempts: readonly ObservationAttempt[],
  ): void {
    for (const attempt of attempts) {
      if (!isObservedScope(attempt, 'map')) continue
      const map = retainPresentMap(frame, attempt.scope.map)
      if (!map) continue
      map.subject = {
        project: attempt.scope.map.project,
        projectName:
          frame.configured.get(keyedProject(attempt.scope.map.project))?.name ??
          attempt.scope.map.project.id,
        id: attempt.scope.map.mapId,
        displayId: attempt.value.displayId,
        title: attempt.value.title,
        url: attempt.value.source.kind === 'issue' ? attempt.value.source.url : undefined,
      }
      if (map.appearancePending && !isQuiet(frame, map.subject.project))
        frame.mapAppearances.push({ type: 'map-appeared', map: map.subject })
      map.appearancePending = false
    }
  }

  function reconcileTicketMembership(
    frame: ComparisonFrame,
    attempts: readonly ObservationAttempt[],
  ): void {
    for (const attempt of attempts) {
      if (!isObservedScope(attempt, 'tickets-membership')) continue
      const map = retainPresentMap(frame, attempt.scope.map)
      if (!map) continue
      for (const member of attempt.value.members) {
        if (frame.absentTickets.has(keyedScopedTicket(member))) continue
        if (!map.tickets.has(member.ticketId)) {
          map.tickets.set(member.ticketId, {
            subject: eventTicket(member, map.subject),
            present: true,
            status: 'unknown',
            isClaimed: false,
            frontier: map.ticketsMembershipKnown ? false : undefined,
          })
        }
      }
      if (attempt.completeness.kind !== 'complete') continue
      const members = new Set(attempt.value.members.map((ticket) => ticket.ticketId))
      for (const [id, ticket] of map.tickets) {
        if (members.has(id)) continue
        frame.absentTickets.add(keyedScopedTicket({ map: attempt.scope.map, ticketId: id }))
        leaveFrontier(frame, map, ticket)
      }
      map.ticketsMembershipKnown = true
    }
  }

  function observeTicketAttempts(
    frame: ComparisonFrame,
    attempts: readonly ObservationAttempt[],
  ): void {
    for (const attempt of attempts) {
      if (attempt.kind === 'proven-absent' && attempt.scope.kind === 'ticket') {
        const map = maps.get(
          keyedMap(attempt.scope.ticket.map.project, attempt.scope.ticket.map.mapId),
        )
        const ticket = map?.tickets.get(attempt.scope.ticket.ticketId)
        if (map?.present && ticket?.present) leaveFrontier(frame, map, ticket)
      }
      if (isObservedScope(attempt, 'ticket')) observeTicket(frame, attempt)
    }
  }

  function observeTicket(
    frame: ComparisonFrame,
    attempt: Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'ticket' } }>,
  ): void {
    const key = attempt.scope.ticket
    if (frame.absentTickets.has(keyedScopedTicket(key))) return
    const map = retainPresentMap(frame, key.map)
    if (!map) return
    const before = map.tickets.get(key.ticketId)
    const subject = eventTicket(key, map.subject, attempt.value)
    const frontier = ticketFrontier(attempt)
    const oldFrontier = before ? before.frontier : map.ticketsMembershipKnown ? false : undefined
    const mapKey = keyedMap(key.map.project, key.map.mapId)
    const suppress = isQuiet(frame, key.map.project) || frame.newMaps.has(mapKey)
    if (!suppress) {
      recordTicketTransition(frame, key, before, attempt.value, subject)
      if (oldFrontier !== undefined && frontier !== undefined && oldFrontier !== frontier) {
        const event = frontierChange(frame, map)
        if (frontier) event.entered.push(subject)
        else if (before) event.left.push(before.subject)
      }
    }
    // Unknown status and frontier evidence cannot replace a known comparison fact.
    map.tickets.set(key.ticketId, {
      subject,
      present: true,
      status:
        attempt.value.status === 'unknown' ? (before?.status ?? 'unknown') : attempt.value.status,
      isClaimed:
        attempt.value.status === 'unknown' ? (before?.isClaimed ?? false) : attempt.value.isClaimed,
      frontier: frontier ?? oldFrontier,
    })
  }

  const unsubscribe = source.onChange((input) => {
    const frame = prepareFrame(input)
    recordExplicitAbsence(frame, input.attempts)
    reconcileMapMembership(frame, input.attempts)
    observeMapSubjects(frame, input.attempts)
    reconcileTicketMembership(frame, input.attempts)
    observeTicketAttempts(frame, input.attempts)
    initialized = true
    const events = orderedBatch(frame, input.order, maps)
    if (events.length === 0) return
    for (const listener of listeners) listener(events)
  })

  return {
    onEvent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    stop() {
      listeners.clear()
      projects.clear()
      maps.clear()
      unsubscribe()
    },
  }
}

function isQuiet(frame: ComparisonFrame, project: ProjectKey): boolean {
  return frame.initial || frame.baseline.has(keyedProject(project))
}

function removeMap(map: MapComparison): void {
  map.present = false
  map.appearancePending = false
  map.ticketsMembershipKnown = false
  map.tickets.clear()
}

function frontierChange(frame: ComparisonFrame, map: MapComparison) {
  const key = keyedMap(map.subject.project, map.subject.id)
  let event = frame.frontiers.get(key)
  if (!event) {
    event = { type: 'frontier-changed', map: map.subject, entered: [], left: [] }
    frame.frontiers.set(key, event)
  }
  return event
}

function recordTicketTransition(
  frame: ComparisonFrame,
  key: SourceTicketKey,
  before: TicketComparison | undefined,
  after: SourceTicketContent,
  subject: EventTicket,
): void {
  if (!before?.present || before.status === 'unknown') return
  const transition = ticketTransition(before, after)
  const transitionKey = keyedScopedTicket(key)
  if (!transition || frame.seenTransitions.has(transitionKey)) return
  frame.seenTransitions.add(transitionKey)
  frame.transitions.push({ type: transition, ticket: subject })
}

/** Presentation orders events but never decides membership or comparison evidence. */
function orderedBatch(
  frame: ComparisonFrame,
  order: ChangeFeedInput['order'],
  maps: ReadonlyMap<string, MapComparison>,
): ChangeEvent[] {
  if (
    frame.mapAppearances.length === 0 &&
    frame.transitions.length === 0 &&
    frame.frontiers.size === 0
  )
    return []
  const mapPositions = new Map<string, number>()
  const ticketPositions = new Map<string, number>()
  for (let mapIndex = 0; mapIndex < order.length; mapIndex += 1) {
    const entry = order[mapIndex]
    if (!entry) continue
    mapPositions.set(keyedMap(entry.map.project, entry.map.mapId), mapIndex)
    for (let ticketIndex = 0; ticketIndex < entry.tickets.length; ticketIndex += 1) {
      const id = entry.tickets[ticketIndex]
      if (id !== undefined)
        ticketPositions.set(keyedScopedTicket({ map: entry.map, ticketId: id }), ticketIndex)
    }
  }
  const mapPosition = (project: ProjectKey, id: string) =>
    mapPositions.get(keyedMap(project, id)) ?? Number.MAX_SAFE_INTEGER
  const ticketPosition = (ticket: EventTicket) =>
    ticketPositions.get(
      keyedScopedTicket({
        map: { project: ticket.project, mapId: ticket.mapId },
        ticketId: ticket.id,
      }),
    ) ?? Number.MAX_SAFE_INTEGER
  frame.mapAppearances.sort(
    (a, b) => mapPosition(a.map.project, a.map.id) - mapPosition(b.map.project, b.map.id),
  )
  frame.transitions.sort(
    (a, b) =>
      mapPosition(a.ticket.project, a.ticket.mapId) -
        mapPosition(b.ticket.project, b.ticket.mapId) ||
      ticketPosition(a.ticket) - ticketPosition(b.ticket),
  )
  const frontierEvents = [...frame.frontiers.values()].sort(
    (a, b) => mapPosition(a.map.project, a.map.id) - mapPosition(b.map.project, b.map.id),
  )
  for (const event of frontierEvents) {
    event.entered.sort((a, b) => ticketPosition(a) - ticketPosition(b))
    const map = maps.get(keyedMap(event.map.project, event.map.id))
    const beforePositions = new Map(
      map ? [...map.tickets.keys()].map((id, index) => [id, index]) : [],
    )
    event.left.sort(
      (a, b) =>
        (beforePositions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (beforePositions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }
  return [
    ...frame.mapAppearances,
    ...frame.transitions,
    ...frontierEvents.filter(
      (event) =>
        !isQuiet(frame, event.map.project) && (event.entered.length > 0 || event.left.length > 0),
    ),
  ]
}

/** A simultaneous claim and close is one action. The close wins. */
function ticketTransition(
  before: TicketComparison,
  after: SourceTicketContent,
): 'ticket-closed' | 'ticket-claimed' | null {
  if (before.status !== 'closed' && after.status === 'closed') return 'ticket-closed'
  if (!before.isClaimed && after.isClaimed && after.status === 'open') return 'ticket-claimed'
  return null
}

function ticketFrontier(
  attempt: Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'ticket' } }>,
): boolean | undefined {
  const ticket = attempt.value
  if (
    ticket.status === 'closed' ||
    ticket.isClaimed ||
    ticket.blockedBy.some((blocker) => blocker.state === 'open')
  )
    return false
  if (
    attempt.completeness.kind === 'complete' &&
    ticket.status === 'open' &&
    ticket.blockersComplete &&
    ticket.blockedBy.every((blocker) => blocker.state === 'closed')
  )
    return true
  return undefined
}

function eventTicket(
  key: SourceTicketKey,
  map: EventMap,
  content?: SourceTicketContent,
): EventTicket {
  return {
    project: key.map.project,
    projectName: map.projectName,
    mapId: key.map.mapId,
    mapDisplayId: map.displayId,
    mapTitle: map.title,
    id: key.ticketId,
    displayId: content?.displayId,
    title: content?.title,
    url: content?.source.kind === 'issue' ? content.source.url : undefined,
  }
}

function keyedMap(project: ProjectKey, mapId: string): string {
  return JSON.stringify(['map', project.integration, project.id, mapId])
}

function keyedScopedTicket(ticket: SourceTicketKey): string {
  return JSON.stringify([
    'ticket',
    ticket.map.project.integration,
    ticket.map.project.id,
    ticket.map.mapId,
    ticket.ticketId,
  ])
}

function keyedProject(project: ProjectKey): string {
  return JSON.stringify([project.integration, project.id])
}

function isObservedScope<K extends SourceScope['kind']>(
  attempt: ObservationAttempt,
  kind: K,
): attempt is Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: K } }> {
  return attempt.kind === 'observed' && attempt.scope.kind === kind
}
