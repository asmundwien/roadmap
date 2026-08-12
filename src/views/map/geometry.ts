import type { Ticket, WayfinderMap } from '../../wayfinder/types.ts'
import { stripInlineMarkdown } from '../gist.ts'

/**
 * The unified-ledger geometry — everything the map screen draws, computed as plain data.
 *
 * This is the winning prototype direction (variant L on `prototype/map-view`) made live. The lane
 * rules come from the commit-graph research (docs/research/commit-graph-layouts.md on
 * `research/commit-graph-layouts`): chains own persistent rails, the heaviest chain forked off
 * HEAD keeps the trunk's lane 0 so merges pull toward the trunk, tributaries sit rightward
 * heaviest-first, and bends happen only at forks and merges. Everything is deterministic by
 * construction — same snapshot, same picture — which is what keeps the poll from reshuffling the
 * map underfoot.
 *
 * One thing the prototype's fixtures never exercised: blocked-by edges can cross repos, and issue
 * numbers only identify a ticket within one repo. Only same-repo blockers become geometry; a
 * cross-repo blocker still counts one step of depth (the ticket really is blocked) but is never
 * followed, drawn, or offered as a hover neighbour.
 */

/**
 * The ledger renders at a fixed 1.25× its 840-unit viewBox (map.css pins the width), so the
 * accordion chrome positioned in CSS around the svg — the flag trigger, the rail segments, the
 * crop offset — converts geometry units to px through this one number.
 */
export const LEDGER_SCALE = 1.25

const W = 840
const GX = 44
const PITCH = 34
/** The gutter is never narrower than four lanes, so sparse maps keep room to breathe. */
const MIN_GUTTER_LANES = 4
const ROW_H = 52
const SEC_PAD = 56
const SEC_BOTTOM = 34
const PAD_TOP = 20
const PAD_BOTTOM = 44
const BEND = 40
const DEST_LINE_H = 21

export interface LedgerRow {
  ticket: Ticket
  x: number
  y: number
}

export interface ClosedRow {
  ticket: Ticket
  y: number
}

export interface FogRow {
  item: string
  x: number
  y: number
}

export interface LedgerEdge {
  key: string
  /** fork: HEAD/blocker into a chain's first row · run: a chain's straight rail · merge: a
   * cross-lane blocked-by · tip: a charted tip dissolving at the fog boundary. */
  kind: 'fork' | 'run' | 'merge' | 'tip'
  /** Ticket number the edge leaves from; null means HEAD. */
  from: number | null
  to: number
  chainId: number
  isClaimed: boolean
  path: string
}

export interface Ledger {
  width: number
  height: number
  gutterX: number
  textX: number
  colWidth: number
  laneCount: number
  destination: string
  destLines: number
  destTextTop: number
  destY: number
  lineHeight: number
  sepFog: number
  sepAhead: number
  sepBehind: number
  headY: number
  /** The trunk ahead of HEAD, dashed — always present, it carries the eye to the destination. */
  trunkDashed: { y1: number; y2: number }
  /** The trunk behind HEAD, solid — null until the first decision lands. */
  trunkSolid: { y1: number; y2: number } | null
  /** Open tickets, one row each: takeable at the bottom, deepest at the top. */
  rows: LedgerRow[]
  /** Closed tickets on the trunk, newest first. */
  closedRows: ClosedRow[]
  fogRows: FogRow[]
  /** One line per empty section — drawn as dim text in the text column, never as a node. */
  placeholders: { y: number; text: string }[]
  edges: LedgerEdge[]
  /** Which chain's rail a ticket rides — hover highlights the whole rail. */
  chainIdOf: Map<number, number>
  /** Open same-repo blockers and dependents per ticket — hover's related set. */
  neighbors: Map<number, number[]>
}

interface Point {
  x: number
  y: number
}

/** A vertical drop from `a` bending once into `b`'s lane — the only curve the ledger allows. */
function connector(a: Point, b: Point): string {
  if (Math.abs(a.x - b.x) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  return [
    `M ${a.x} ${a.y}`,
    `L ${a.x} ${b.y + BEND}`,
    `C ${a.x} ${b.y + BEND * 0.35}, ${b.x} ${b.y + BEND * 0.65}, ${b.x} ${b.y}`,
  ].join(' ')
}

/**
 * A fork's mirror image of `connector`: it leaves `a`'s lane immediately and rides `b`'s lane the
 * rest of the way up. The split is drawn *before* anything else in the parent's lane — parallel
 * chains off one point diverge at that point, never implying one comes first.
 */
function forkConnector(a: Point, b: Point): string {
  if (Math.abs(a.x - b.x) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  const bendTo = a.y - BEND
  if (bendTo <= b.y) {
    const span = a.y - b.y
    return `M ${a.x} ${a.y} C ${a.x} ${a.y - span * 0.35}, ${b.x} ${a.y - span * 0.65}, ${b.x} ${b.y}`
  }
  return [
    `M ${a.x} ${a.y}`,
    `C ${a.x} ${a.y - BEND * 0.35}, ${b.x} ${a.y - BEND * 0.65}, ${b.x} ${bendTo}`,
    `L ${b.x} ${b.y}`,
  ].join(' ')
}

/** Open blockers that live in this map — the only edges the ledger can draw. */
function openInMapBlockers(ticket: Ticket, home: string, openNumbers: Set<number>): number[] {
  return ticket.blockedBy
    .filter((b) => b.isOpen && b.nameWithOwner === home && openNumbers.has(b.number))
    .map((b) => b.number)
}

/**
 * The longest chain of still-open blockers between a ticket and being takeable. 0 means takeable
 * now. Closed blockers count for nothing — that route is walked. A cross-repo open blocker counts
 * one step (the ticket is blocked) but is never followed.
 */
export function openDepth(ticket: Ticket, byNumber: Map<number, Ticket>, home: string): number {
  const seen = new Set<number>()
  const walk = (t: Ticket): number => {
    if (seen.has(t.number)) return 0
    seen.add(t.number)
    let deepest = 0
    for (const blocker of t.blockedBy) {
      if (!blocker.isOpen) continue
      const upstream = blocker.nameWithOwner === home ? byNumber.get(blocker.number) : undefined
      deepest = Math.max(deepest, 1 + (upstream ? walk(upstream) : 0))
    }
    seen.delete(t.number)
    return deepest
  }
  return walk(ticket)
}

interface Layered {
  closed: Ticket[]
  /** Open tickets grouped by `openDepth`, index 0 being everything takeable now. */
  ahead: Ticket[][]
  depthOf: Map<number, number>
}

function layerMap(map: WayfinderMap): Layered {
  const byNumber = new Map(map.tickets.map((t) => [t.number, t]))
  // Ground covered reads as a log: most recently closed at the top, walking back in time. A
  // ticket without a close time (shouldn't happen for a closed issue) sinks to the bottom.
  const closed = map.tickets
    .filter((t) => t.state === 'closed')
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  const open = map.tickets.filter((t) => t.state !== 'closed')

  const depthOf = new Map<number, number>()
  for (const ticket of open)
    depthOf.set(ticket.number, openDepth(ticket, byNumber, map.nameWithOwner))

  const maxDepth = open.reduce((max, t) => Math.max(max, depthOf.get(t.number) ?? 0), 0)
  const ahead: Ticket[][] = Array.from({ length: maxDepth + 1 }, () => [])
  for (const ticket of open) ahead[depthOf.get(ticket.number) ?? 0]?.push(ticket)

  return { closed, ahead, depthOf }
}

/**
 * Order each layer so a ticket sits near the blockers it waits on in the layers below —
 * barycentric ordering, the cheap trick that keeps edges flowing instead of crossing.
 */
function orderLayers(ahead: Ticket[][], home: string, openNumbers: Set<number>): Ticket[][] {
  const slot = new Map<number, number>()
  return ahead.map((layer, depth) => {
    const sorted = [...layer].sort((a, b) => a.number - b.number)
    if (depth > 0) {
      const key = (t: Ticket): number => {
        const upstream = openInMapBlockers(t, home, openNumbers).filter((n) => slot.has(n))
        if (upstream.length === 0) return 0.5
        return upstream.reduce((sum, n) => sum + (slot.get(n) ?? 0.5), 0) / upstream.length
      }
      sorted.sort((a, b) => key(a) - key(b) || a.number - b.number)
    }
    sorted.forEach((t, i) => {
      slot.set(t.number, sorted.length === 1 ? 0.5 : i / (sorted.length - 1))
    })
    return sorted
  })
}

interface Chain {
  id: number
  /** In depth order — the first ticket is where the rail begins. */
  tickets: Ticket[]
  /** Ticket number the chain forks from; null means it forks off HEAD. */
  forkFrom: number | null
}

interface ChainWork {
  layers: Ticket[][]
  chains: Chain[]
  chainOf: Map<number, Chain>
  /** How many open tickets transitively wait on this one — the "weight" tiebreaker. */
  descCount: Map<number, number>
}

/**
 * Decompose the ahead-of-HEAD DAG into chains that own rails. A merge sits ON the rail of its
 * heaviest incoming chain while the other rails visibly retire into it.
 */
function decomposeChains(layers: Ticket[][], home: string): ChainWork {
  const open = layers.flat()
  const openNumbers = new Set(open.map((t) => t.number))

  const dependents = new Map<number, number[]>()
  for (const t of open) {
    for (const n of openInMapBlockers(t, home, openNumbers)) {
      dependents.set(n, [...(dependents.get(n) ?? []), t.number])
    }
  }
  const descCount = new Map<number, number>()
  for (const t of open) {
    const seen = new Set<number>()
    const walk = (n: number) => {
      for (const k of dependents.get(n) ?? []) {
        if (!seen.has(k)) {
          seen.add(k)
          walk(k)
        }
      }
    }
    walk(t.number)
    descCount.set(t.number, seen.size)
  }

  const chains: Chain[] = []
  const chainOf = new Map<number, Chain>()
  const tipOf = new Map<Chain, number>()

  const weightOf = (chain: Chain): number =>
    chain.tickets.length + (descCount.get(tipOf.get(chain) ?? -1) ?? 0)

  for (const layer of layers) {
    for (const ticket of layer) {
      const openBlockers = openInMapBlockers(ticket, home, openNumbers)
      // A rail is free to continue only while the blocker is still its tip.
      const candidates = openBlockers
        .map((n) => chainOf.get(n))
        .filter((c): c is Chain => c !== undefined && openBlockers.includes(tipOf.get(c) ?? -1))
      const unique = [...new Set(candidates)]
      unique.sort((a, b) => weightOf(b) - weightOf(a) || a.id - b.id)
      const surviving = unique[0]
      if (surviving) {
        surviving.tickets.push(ticket)
        chainOf.set(ticket.number, surviving)
        tipOf.set(surviving, ticket.number)
      } else {
        const chain: Chain = {
          id: chains.length,
          tickets: [ticket],
          forkFrom: openBlockers[0] ?? null,
        }
        chains.push(chain)
        chainOf.set(ticket.number, chain)
        tipOf.set(chain, ticket.number)
      }
    }
  }

  return { layers, chains, chainOf, descCount }
}

/** The chain's weight once decomposition is done — tickets carried plus what waits on its head. */
function chainWeight(chain: Chain, descCount: Map<number, number>): number {
  const first = chain.tickets[0]
  return chain.tickets.length + (first ? (descCount.get(first.number) ?? 0) : 0)
}

interface Lanes {
  spine: Chain | undefined
  laneOf: (n: number) => number
  laneCount: number
}

/**
 * Lane 0 is the trunk's own lane: the heaviest chain forked off HEAD continues it, so merges pull
 * toward the trunk. Tributaries take lanes rightward, heaviest first.
 */
function assignLanes(
  chains: Chain[],
  chainOf: Map<number, Chain>,
  descCount: Map<number, number>,
): Lanes {
  const byWeight = (a: Chain, b: Chain) =>
    chainWeight(b, descCount) - chainWeight(a, descCount) ||
    (a.tickets[0]?.number ?? 0) - (b.tickets[0]?.number ?? 0)
  const spine = chains.filter((c) => c.forkFrom === null).sort(byWeight)[0]
  const laneIndex = new Map<Chain, number>()
  if (spine) laneIndex.set(spine, 0)
  const tributaries = chains.filter((c) => c !== spine).sort(byWeight)
  for (const [i, chain] of tributaries.entries()) laneIndex.set(chain, i + 1)
  return {
    spine,
    laneOf: (n) => {
      const chain = chainOf.get(n)
      return chain ? (laneIndex.get(chain) ?? 0) : 0
    },
    laneCount: Math.max(chains.length, 2),
  }
}

/** Forks off HEAD or a blocker, straight rails through rows, merges into surviving rails. */
function buildBraidEdges(
  chains: Chain[],
  rowByNumber: Map<number, LedgerRow>,
  head: Point,
): LedgerEdge[] {
  const edges: LedgerEdge[] = []
  for (const chain of chains) {
    const first = chain.tickets[0]
    const last = chain.tickets[chain.tickets.length - 1]
    if (!first || !last) continue
    const firstRow = rowByNumber.get(first.number)
    const lastRow = rowByNumber.get(last.number)
    if (!firstRow || !lastRow) continue
    const parent = chain.forkFrom === null ? head : (rowByNumber.get(chain.forkFrom) ?? head)
    edges.push({
      key: `fork-${chain.id}`,
      kind: 'fork',
      from: chain.forkFrom,
      to: first.number,
      chainId: chain.id,
      isClaimed: first.state === 'claimed',
      path: forkConnector(parent, firstRow),
    })
    if (lastRow.y < firstRow.y) {
      edges.push({
        key: `run-${chain.id}`,
        kind: 'run',
        from: first.number,
        to: last.number,
        chainId: chain.id,
        isClaimed: false,
        path: `M ${firstRow.x} ${firstRow.y} L ${lastRow.x} ${lastRow.y}`,
      })
    }
  }
  return edges
}

/** Cross-lane merges into surviving rails, and charted tips dissolving at the fog boundary. */
function buildCrossEdges(
  rows: LedgerRow[],
  rowByNumber: Map<number, LedgerRow>,
  chainOf: Map<number, Chain>,
  spine: Chain | undefined,
  home: string,
  openNumbers: Set<number>,
  sepAhead: number,
): LedgerEdge[] {
  const edges: LedgerEdge[] = []
  for (const { ticket, x, y } of rows) {
    for (const n of openInMapBlockers(ticket, home, openNumbers)) {
      const from = rowByNumber.get(n)
      if (!from || Math.abs(from.x - x) < 1) continue
      edges.push({
        key: `merge-${ticket.number}-${n}`,
        kind: 'merge',
        from: n,
        to: ticket.number,
        chainId: chainOf.get(ticket.number)?.id ?? -1,
        isClaimed: false,
        path: connector(from, { x, y }),
      })
    }
  }
  const dependedOn = new Set(rows.flatMap((r) => openInMapBlockers(r.ticket, home, openNumbers)))
  for (const { ticket, x, y } of rows) {
    if (dependedOn.has(ticket.number) || chainOf.get(ticket.number) === spine) continue
    edges.push({
      key: `tip-${ticket.number}`,
      kind: 'tip',
      from: null,
      to: ticket.number,
      chainId: chainOf.get(ticket.number)?.id ?? -1,
      isClaimed: false,
      path: `M ${x} ${y} L ${x} ${sepAhead + 26}`,
    })
  }
  return edges
}

/** Open same-repo blockers and dependents per ticket, both directions — hover's related set. */
function buildNeighbors(
  open: Ticket[],
  home: string,
  openNumbers: Set<number>,
): Map<number, number[]> {
  const neighbors = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    neighbors.set(a, [...(neighbors.get(a) ?? []), b])
  }
  for (const t of open) {
    for (const n of openInMapBlockers(t, home, openNumbers)) {
      link(t.number, n)
      link(n, t.number)
    }
  }
  return neighbors
}

export function buildLedger(map: WayfinderMap): Ledger {
  const home = map.nameWithOwner
  const { closed, ahead, depthOf } = layerMap(map)
  const openNumbers = new Set(ahead.flat().map((t) => t.number))
  const layers = orderLayers(ahead, home, openNumbers)
  const { chains, chainOf, descCount } = decomposeChains(layers, home)
  const { spine, laneOf, laneCount } = assignLanes(chains, chainOf, descCount)
  const textX = GX + Math.max(laneCount, MIN_GUTTER_LANES) * PITCH + 44

  const ordered = layers.flat()
  ordered.sort((a, b) => {
    const da = depthOf.get(a.number) ?? 0
    const db = depthOf.get(b.number) ?? 0
    if (da !== db) return da - db
    return laneOf(a.number) - laneOf(b.number) || a.number - b.number
  })

  // The vertical frame, top to bottom: destination, fog, charted ahead, ground covered — every
  // section with the same rhythm: SEC_PAD to its first row, ROW_H pitch, SEC_BOTTOM after its last.
  const destination = stripInlineMarkdown(map.body.destination)
  const colWidth = W - textX - 28
  const destLines = Math.min(4, Math.max(2, Math.ceil(destination.length / (colWidth / 7.4))))
  const destTextTop = PAD_TOP + 28
  const destY = destTextTop + 10
  const sepFog = destTextTop + destLines * DEST_LINE_H + 26

  // An empty section keeps the shared rhythm: its one placeholder line sits where a first row
  // would, and the section closes SEC_BOTTOM below it.
  const sectionHeight = (count: number) => SEC_PAD + Math.max(count - 1, 0) * ROW_H + SEC_BOTTOM

  const fogItems = map.body.notYetSpecified.map(stripInlineMarkdown)
  const ghostY = (i: number) => sepFog + SEC_PAD + i * ROW_H
  const sepAhead = sepFog + sectionHeight(fogItems.length)

  const sepBehind = sepAhead + sectionHeight(ordered.length)
  const rowY = (i: number) => sepBehind - SEC_BOTTOM - i * ROW_H

  const behindY = (j: number) => sepBehind + SEC_PAD + j * ROW_H
  const height = sepBehind + sectionHeight(closed.length) + PAD_BOTTOM

  const placeholders: { y: number; text: string }[] = []
  if (fogItems.length === 0) {
    const note = stripInlineMarkdown(map.body.notYetSpecifiedNote).trim()
    placeholders.push({ y: sepFog + SEC_PAD, text: note !== '' ? note : 'no fog recorded' })
  }
  if (ordered.length === 0)
    placeholders.push({ y: sepAhead + SEC_PAD, text: 'nothing charted ahead' })
  if (closed.length === 0)
    placeholders.push({ y: sepBehind + SEC_PAD, text: 'nothing decided yet' })

  const rows: LedgerRow[] = ordered.map((ticket, i) => ({
    ticket,
    x: GX + laneOf(ticket.number) * PITCH,
    y: rowY(i),
  }))
  const rowByNumber = new Map(rows.map((r) => [r.ticket.number, r]))
  const head: Point = { x: GX, y: sepBehind }

  const closedRows: ClosedRow[] = closed.map((ticket, j) => ({ ticket, y: behindY(j) }))

  // Ghost stops scatter across the whole gutter — clear of the trunk, clear of the text column.
  const fogMin = GX + 26
  const fogMax = textX - 62
  const fogRows: FogRow[] = fogItems.map((item, i) => ({
    item,
    x: fogMin + ((i * 0.618 + 0.35) % 1) * (fogMax - fogMin),
    y: ghostY(i),
  }))

  const edges: LedgerEdge[] = [
    ...buildBraidEdges(chains, rowByNumber, head),
    ...buildCrossEdges(rows, rowByNumber, chainOf, spine, home, openNumbers, sepAhead),
  ]

  const chainIdOf = new Map<number, number>()
  for (const [n, chain] of chainOf) chainIdOf.set(n, chain.id)

  const neighbors = buildNeighbors(ordered, home, openNumbers)

  const lastSpineRow = [...rows].reverse().find((r) => chainOf.get(r.ticket.number) === spine)
  const lastClosed = closedRows[closedRows.length - 1]

  return {
    width: W,
    height,
    gutterX: GX,
    textX,
    colWidth,
    laneCount,
    destination,
    destLines,
    destTextTop,
    destY,
    lineHeight: DEST_LINE_H,
    sepFog,
    sepAhead,
    sepBehind,
    headY: head.y,
    trunkDashed: { y1: lastSpineRow ? lastSpineRow.y : head.y, y2: destY + 14 },
    trunkSolid: lastClosed ? { y1: head.y, y2: lastClosed.y + ROW_H * 0.6 } : null,
    rows,
    closedRows,
    fogRows,
    placeholders,
    edges,
    chainIdOf,
    neighbors,
  }
}
