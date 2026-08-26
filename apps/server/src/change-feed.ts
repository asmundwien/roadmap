import type { Project, ProjectKey, Snapshot, Ticket, WayfinderMap } from '@roadmap/contracts'

/** A ticket named by an event, carrying the map it sits on so subscribers need no lookup. */
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
export interface EventMap {
  project: ProjectKey
  projectName: string
  id: string
  displayId?: string
  title?: string
  url?: string
}

/**
 * The domain events the change feed emits are derived from consecutive snapshots. The Integration
 * and observation mechanism that found a change are invisible to consumers.
 */
export type ChangeEvent =
  | { type: 'map-appeared'; map: EventMap }
  | { type: 'ticket-claimed'; ticket: EventTicket }
  | { type: 'ticket-closed'; ticket: EventTicket }
  | { type: 'frontier-changed'; map: EventMap; entered: EventTicket[]; left: EventTicket[] }

interface MapEntry {
  project: Project
  map: WayfinderMap
}

/**
 * Diffs two consecutive snapshots into domain events. Pure; order is stable: map appearances,
 * then ticket transitions, then frontier deltas, each in `next`'s own ordering.
 */
export function diffSnapshots(previous: Snapshot, next: Snapshot): ChangeEvent[] {
  const previousMaps = mapsByKey(previous)
  const nextMaps = mapsByKey(next)
  const events: ChangeEvent[] = []
  for (const [key, entry] of nextMaps) {
    if (!previousMaps.has(key)) events.push({ type: 'map-appeared', map: toEventMap(entry) })
  }
  events.push(...ticketTransitions(previousMaps, nextMaps))
  for (const [key, entry] of nextMaps) {
    const before = previousMaps.get(key)
    if (!before) continue
    const delta = frontierDelta(before, entry)
    if (delta) events.push(delta)
  }
  return events
}

function ticketTransitions(
  previousMaps: Map<string, MapEntry>,
  nextMaps: Map<string, MapEntry>,
): ChangeEvent[] {
  const events: ChangeEvent[] = []
  // A ticket can sit under more than one map in the snapshot; each transition fires once.
  const seen = new Set<string>()
  for (const [key, entry] of nextMaps) {
    const before = previousMaps.get(key)
    if (!before) continue
    const beforeTickets = ticketsById(before.map)
    for (const ticket of entry.map.tickets) {
      const was = beforeTickets.get(ticket.id)
      const ticketKey = keyedTicket(entry.map.project, ticket.id)
      if (!was || seen.has(ticketKey)) continue
      const transition = ticketTransition(was, ticket)
      if (!transition) continue
      seen.add(ticketKey)
      events.push({ type: transition, ticket: toEventTicket(ticket, entry) })
    }
  }
  return events
}

/** A claim that lands in the same diff as the close reads as one action: the close wins. */
function ticketTransition(was: Ticket, now: Ticket): 'ticket-closed' | 'ticket-claimed' | null {
  if (was.state !== 'closed' && now.state === 'closed') return 'ticket-closed'
  if (!was.isClaimed && now.isClaimed && now.state !== 'closed') return 'ticket-claimed'
  return null
}

function frontierDelta(before: MapEntry, after: MapEntry): ChangeEvent | null {
  const wasFrontier = new Set(before.map.frontier.map((ticket) => ticket.id))
  const isFrontier = new Set(after.map.frontier.map((ticket) => ticket.id))
  const entered = after.map.frontier
    .filter((ticket) => !wasFrontier.has(ticket.id))
    .map((ticket) => toEventTicket(ticket, after))
  const left = before.map.frontier
    .filter((ticket) => !isFrontier.has(ticket.id))
    .map((ticket) => toEventTicket(ticket, before))
  if (entered.length === 0 && left.length === 0) return null
  return { type: 'frontier-changed', map: toEventMap(after), entered, left }
}

export interface ChangeFeed {
  /** Registers for event batches — one batch per snapshot change that produced any events. */
  onEvent(listener: (events: ChangeEvent[]) => void): () => void
  /** Replaces the comparison baseline without emitting activity. */
  reset(snapshot: Snapshot): void
  stop(): void
}

interface SnapshotSource {
  onChange(listener: (snapshot: Snapshot) => void): () => void
}

/**
 * The trigger seam: subscribes to the store and turns each snapshot change into domain events.
 * The first snapshot it sees is the baseline — observed, never diffed, so no triggers fire from
 * the baseline sweep.
 */
export function createChangeFeed(source: SnapshotSource): ChangeFeed {
  const listeners = new Set<(events: ChangeEvent[]) => void>()
  let previous: Snapshot | null = null

  const unsubscribe = source.onChange((snapshot) => {
    if (previous === null) {
      previous = snapshot
      return
    }
    const events = diffSnapshots(previous, snapshot)
    previous = snapshot
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
    reset(snapshot) {
      previous = snapshot
    },
    stop() {
      listeners.clear()
      unsubscribe()
    },
  }
}

function mapsByKey(snapshot: Snapshot): Map<string, MapEntry> {
  const maps = new Map<string, MapEntry>()
  for (const project of snapshot.projects) {
    for (const map of [...project.openMaps, ...project.closedMaps]) {
      maps.set(keyedMap(map.project, map.id), { project, map })
    }
  }
  return maps
}

function ticketsById(map: WayfinderMap): Map<string, Ticket> {
  return new Map(map.tickets.map((ticket) => [ticket.id, ticket]))
}

function toEventMap(entry: MapEntry): EventMap {
  return {
    project: entry.map.project,
    projectName: entry.project.name,
    id: entry.map.id,
    displayId: entry.map.displayId,
    title: entry.map.title,
    url: entry.map.url,
  }
}

function toEventTicket(ticket: Ticket, entry: MapEntry): EventTicket {
  return {
    project: entry.map.project,
    projectName: entry.project.name,
    mapId: entry.map.id,
    mapDisplayId: entry.map.displayId,
    mapTitle: entry.map.title,
    id: ticket.id,
    displayId: ticket.displayId,
    title: ticket.title,
    url: ticket.url,
  }
}

function keyedMap(project: ProjectKey, mapId: string): string {
  return `${project.integration}:${project.id}:map:${mapId}`
}

function keyedTicket(project: ProjectKey, ticketId: string): string {
  return `${project.integration}:${project.id}:ticket:${ticketId}`
}
