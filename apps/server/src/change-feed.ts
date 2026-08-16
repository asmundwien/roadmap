import type { Snapshot, Ticket, WayfinderMap } from '@roadmap/contracts'

/** A ticket named by an event, carrying the map it sits on so subscribers need no lookup. */
export interface EventTicket {
  number: number
  title: string
  url: string
  mapTitle: string
  /** The map's repo — a cross-repo child still reports where its map lives. */
  nameWithOwner: string
}

/** A map named by an event. */
export interface EventMap {
  nameWithOwner: string
  number: number
  title: string
  url: string
}

/**
 * The domain events the change feed emits — derived by diffing consecutive snapshots, so they are
 * source-blind by construction: whether a webhook or a reconciling sweep caught the change is
 * invisible here (CONTEXT.md, "Change feed").
 */
export type ChangeEvent =
  | { type: 'map-appeared'; map: EventMap }
  | { type: 'ticket-claimed'; ticket: EventTicket }
  | { type: 'ticket-closed'; ticket: EventTicket }
  | { type: 'frontier-changed'; map: EventMap; entered: EventTicket[]; left: EventTicket[] }

/**
 * Diffs two consecutive snapshots into domain events. Pure; order is stable: map appearances,
 * then ticket transitions, then frontier deltas, each in `next`'s own ordering.
 */
export function diffSnapshots(previous: Snapshot, next: Snapshot): ChangeEvent[] {
  const previousMaps = mapsByKey(previous)
  const nextMaps = mapsByKey(next)
  const events: ChangeEvent[] = []
  for (const [key, map] of nextMaps) {
    if (!previousMaps.has(key)) events.push({ type: 'map-appeared', map: toEventMap(map) })
  }
  events.push(...ticketTransitions(previousMaps, nextMaps))
  for (const [key, map] of nextMaps) {
    const before = previousMaps.get(key)
    if (!before) continue
    const delta = frontierDelta(before, map)
    if (delta) events.push(delta)
  }
  return events
}

function ticketTransitions(
  previousMaps: Map<string, WayfinderMap>,
  nextMaps: Map<string, WayfinderMap>,
): ChangeEvent[] {
  const events: ChangeEvent[] = []
  // A ticket can sit under more than one map in the snapshot; each transition fires once.
  const seen = new Set<string>()
  for (const [key, map] of nextMaps) {
    const before = previousMaps.get(key)
    if (!before) continue
    const beforeTickets = ticketsByUrl(before)
    for (const ticket of map.tickets) {
      const was = beforeTickets.get(ticket.url)
      if (!was || seen.has(ticket.url)) continue
      const transition = ticketTransition(was, ticket)
      if (!transition) continue
      seen.add(ticket.url)
      events.push({ type: transition, ticket: toEventTicket(ticket, map) })
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

function frontierDelta(before: WayfinderMap, map: WayfinderMap): ChangeEvent | null {
  const wasFrontier = new Set(before.frontier.map((ticket) => ticket.url))
  const isFrontier = new Set(map.frontier.map((ticket) => ticket.url))
  const entered = map.frontier
    .filter((ticket) => !wasFrontier.has(ticket.url))
    .map((ticket) => toEventTicket(ticket, map))
  const left = before.frontier
    .filter((ticket) => !isFrontier.has(ticket.url))
    .map((ticket) => toEventTicket(ticket, before))
  if (entered.length === 0 && left.length === 0) return null
  return { type: 'frontier-changed', map: toEventMap(map), entered, left }
}

export interface ChangeFeed {
  /** Registers for event batches — one batch per snapshot change that produced any events. */
  onEvent(listener: (events: ChangeEvent[]) => void): () => void
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
    stop() {
      listeners.clear()
      unsubscribe()
    },
  }
}

function mapsByKey(snapshot: Snapshot): Map<string, WayfinderMap> {
  const maps = new Map<string, WayfinderMap>()
  for (const project of snapshot.projects) {
    for (const map of [...project.openMaps, ...project.closedMaps]) {
      maps.set(`${map.nameWithOwner}#${map.number}`, map)
    }
  }
  return maps
}

function ticketsByUrl(map: WayfinderMap): Map<string, Ticket> {
  return new Map(map.tickets.map((ticket) => [ticket.url, ticket]))
}

function toEventMap(map: WayfinderMap): EventMap {
  return { nameWithOwner: map.nameWithOwner, number: map.number, title: map.title, url: map.url }
}

function toEventTicket(ticket: Ticket, map: WayfinderMap): EventTicket {
  return {
    number: ticket.number,
    title: ticket.title,
    url: ticket.url,
    mapTitle: map.title,
    nameWithOwner: map.nameWithOwner,
  }
}
