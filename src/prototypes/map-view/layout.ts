/**
 * PROTOTYPE — throwaway. The one piece of geometry every graph variant needs: how far ahead of the
 * frontier a ticket sits. Variants disagree about what to do with it (columns, rings), which is the
 * point — they must not share a layout.
 */

import type { Ticket, WayfinderMap } from '../../wayfinder/types.ts'

/**
 * The longest chain of *still-open* blockers standing between a ticket and being takeable.
 *
 * 0 means takeable now (frontier or claimed). Closed blockers count for nothing — the route through
 * them has already been walked — so depth measures remaining distance, not total dependency height.
 */
export function openDepth(ticket: Ticket, byNumber: Map<number, Ticket>): number {
  const seen = new Set<number>()
  const walk = (t: Ticket): number => {
    if (seen.has(t.number)) return 0
    seen.add(t.number)
    let deepest = 0
    for (const blocker of t.blockedBy) {
      if (!blocker.isOpen) continue
      const upstream = byNumber.get(blocker.number)
      deepest = Math.max(deepest, 1 + (upstream ? walk(upstream) : 0))
    }
    seen.delete(t.number)
    return deepest
  }
  return walk(ticket)
}

export interface Layered {
  byNumber: Map<number, Ticket>
  closed: Ticket[]
  /** Open tickets grouped by `openDepth`, index 0 being everything takeable now. */
  ahead: Ticket[][]
  depthOf: Map<number, number>
}

export function layerMap(map: WayfinderMap): Layered {
  const byNumber = new Map(map.tickets.map((t) => [t.number, t]))
  const closed = map.tickets.filter((t) => t.state === 'closed')
  const open = map.tickets.filter((t) => t.state !== 'closed')

  const depthOf = new Map<number, number>()
  for (const ticket of open) depthOf.set(ticket.number, openDepth(ticket, byNumber))

  const maxDepth = open.reduce((max, t) => Math.max(max, depthOf.get(t.number) ?? 0), 0)
  const ahead: Ticket[][] = Array.from({ length: maxDepth + 1 }, () => [])
  for (const ticket of open) ahead[depthOf.get(ticket.number) ?? 0]?.push(ticket)

  return { byNumber, closed, ahead, depthOf }
}

/** The open blockers a ticket is actually waiting on — the edges worth drawing. */
export function openBlockersOf(ticket: Ticket): number[] {
  return ticket.blockedBy.filter((b) => b.isOpen).map((b) => b.number)
}
