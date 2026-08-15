import type { Ticket, WayfinderMap } from '@roadmap/contracts'
import { stripInlineMarkdown } from '../gist.ts'

/**
 * The unified-ledger geometry — everything the map screen draws, computed as plain data.
 *
 * The whole map is ONE graph. Rows run in road order — oldest decision at the bottom, newest at
 * HEAD, then the open work by distance-from-takeable up to the fog — and a single commit-graph
 * weave lays every ticket out, ground covered and charted ahead alike; the "ground covered"
 * boundary is a separator line the threads simply cross. The weave (see `weave`) follows the
 * commit-graph research (docs/research/commit-graph-layouts.md): a placed ticket holds its lane
 * until its last drawn dependent arrives, that dependent inherits the lane so the rail continues,
 * other blockers bend in as merges, and freed lanes return to a pool for later threads — the
 * graph reuses its whitespace instead of growing a new column per branch. Reservation is also
 * what keeps the picture honest: an edge only ever rides a lane its blocker holds, so no line can
 * pass through a node it doesn't touch. Everything is deterministic by construction — same
 * snapshot, same picture — which is what keeps the poll from reshuffling the map underfoot.
 *
 * Merges obey the Hasse rule: a blocked-by that a longer chain of drawn edges already implies is
 * not drawn again, so the picture carries the dependency *order* without restating every shortcut
 * GitHub happens to know about — hover still walks the full graph; reduction trims ink, not
 * truth.
 *
 * Cross-repo blocked-by edges never become geometry: issue numbers only identify a ticket within
 * one repo, so a cross-repo blocker counts one step of depth (the ticket really is blocked) but
 * is never followed, drawn, or offered as a hover neighbour.
 *
 * Origins: a rootless closed ticket that other work depends on forks off the ticket whose
 * resolution spawned it — wayfinder fires research subagents from the session that just closed
 * something, and creation time identifies that something. Anything else rootless simply starts
 * where it stands, edge-free: a stroke to HEAD or the trunk would claim a dependency that does
 * not exist, and a node without recorded relations honestly has none.
 */

/**
 * The ledger renders at a fixed 1.25× its 900-unit viewBox (map.css pins the width), so the
 * accordion chrome positioned in CSS around the svg — the flag trigger, the rail segments, the
 * crop offset — converts geometry units to px through this one number.
 */
export const LEDGER_SCALE = 1.25

const W = 900
const GX = 44
const PITCH = 34
/** The gutter is never narrower than four lanes, so sparse maps keep room to breathe. */
const MIN_GUTTER_LANES = 4
/** ...and never wider than ten at full pitch: a busier weave compresses its lanes evenly rather
 * than swallowing the text column. */
const MAX_GUTTER = 10 * PITCH
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
  x: number
  y: number
}

export interface FogRow {
  item: string
  x: number
  y: number
}

export interface LedgerEdge {
  key: string
  /** run: a rail segment, blocker straight up to the dependent that inherited its lane · merge: a
   * blocked-by bending from the blocker's lane into its dependent · fork: a spawner's origin
   * stroke into the ticket it spawned · tip: an undepended open ticket dissolving at the fog
   * boundary. */
  kind: 'fork' | 'run' | 'merge' | 'tip'
  /** Ticket number the edge leaves from; null only for tips, which rise from their own ticket. */
  from: number | null
  to: number
  /** True when `from → to` is a real blocked-by edge. False for the narrative strokes — forks
   * off HEAD, spawner forks, tips — so hover can light the dependency graph without dragging the
   * scenery along. */
  isDependency: boolean
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
  /** The road behind HEAD, solid — from the topmost lane-0 decision down past the oldest row;
   * null until the first decision lands. It stops where the real rails take over, so a dashed
   * rail crossing into open work is never overpainted solid. */
  trunkSolid: { y1: number; y2: number } | null
  /** Open tickets, one row each: takeable at the bottom, deepest at the top. */
  rows: LedgerRow[]
  /** Closed tickets, newest first — each on the lane the weave gave its thread. */
  closedRows: ClosedRow[]
  fogRows: FogRow[]
  /** One line per empty section — drawn as dim text in the text column, never as a node. */
  placeholders: { y: number; text: string }[]
  edges: LedgerEdge[]
  /** Direct same-repo in-map blockers per ticket — hover walks these upstream, transitively. */
  blockersOf: Map<number, number[]>
  /** Direct same-repo in-map dependents per ticket — hover lights these one hop downstream. */
  dependentsOf: Map<number, number[]>
}

interface Point {
  x: number
  y: number
}

/** A vertical drop from `a` bending once into `b`'s lane — the merge stroke. */
function connector(a: Point, b: Point): string {
  if (Math.abs(a.x - b.x) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  return [
    `M ${a.x} ${a.y}`,
    `L ${a.x} ${b.y + BEND}`,
    `C ${a.x} ${b.y + BEND * 0.35}, ${b.x} ${b.y + BEND * 0.65}, ${b.x} ${b.y}`,
  ].join(' ')
}

/**
 * A fork's mirror image of `connector`: it leaves `a` immediately and rides `b`'s lane the rest
 * of the way up. The split is drawn *before* anything else near the parent, so parallel branches
 * off one point diverge at that point, never implying one comes first.
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

/** Open blockers that live in this map — what the depth layering follows. */
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
  /** Closed tickets, newest first — ground covered reads as a log. */
  closed: Ticket[]
  /** Open tickets grouped by `openDepth`, index 0 being everything takeable now. */
  ahead: Ticket[][]
}

function layerMap(map: WayfinderMap): Layered {
  const byNumber = new Map(map.tickets.map((t) => [t.number, t]))
  // A ticket without a close time (shouldn't happen for a closed issue) sinks to the bottom.
  const closed = map.tickets
    .filter((t) => t.state === 'closed')
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  const open = map.tickets.filter((t) => t.state !== 'closed')

  const maxDepth = open.reduce(
    (max, t) => Math.max(max, openDepth(t, byNumber, map.nameWithOwner)),
    0,
  )
  const ahead: Ticket[][] = Array.from({ length: maxDepth + 1 }, () => [])
  for (const ticket of open) ahead[openDepth(ticket, byNumber, map.nameWithOwner)]?.push(ticket)

  return { closed, ahead }
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

/** The raw same-repo in-map blocked-by graph, both directions — what hover walks. */
function buildRelations(
  tickets: Ticket[],
  home: string,
  inMap: Set<number>,
): { blockersOf: Map<number, number[]>; dependentsOf: Map<number, number[]> } {
  const blockersOf = new Map<number, number[]>()
  const dependentsOf = new Map<number, number[]>()
  for (const t of tickets) {
    for (const b of t.blockedBy) {
      if (b.nameWithOwner !== home || !inMap.has(b.number)) continue
      blockersOf.set(t.number, [...(blockersOf.get(t.number) ?? []), b.number])
      dependentsOf.set(b.number, [...(dependentsOf.get(b.number) ?? []), t.number])
    }
  }
  return { blockersOf, dependentsOf }
}

/**
 * The Hasse rule: true when `from → to` is already implied by a longer chain of edges, so drawing
 * it directly would only restate what the rails between them say. Reduction of a DAG is unique,
 * so this stays deterministic whatever order edges are considered in.
 */
function isTransitive(from: number, to: number, dependentsOf: Map<number, number[]>): boolean {
  const seen = new Set<number>([from])
  const stack = (dependentsOf.get(from) ?? []).filter((n) => n !== to)
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    if (seen.has(n)) continue
    seen.add(n)
    for (const d of dependentsOf.get(n) ?? []) {
      if (d === to) return true
      stack.push(d)
    }
  }
  return false
}

/**
 * Wayfinder spawns newly-surfaced tickets from the session that just resolved another, so a
 * rootless closed ticket that other work depends on forks off the non-research ticket that
 * closed most recently before it was created. Research never spawns — its subagent only
 * resolves. A rootless ticket nothing depends on stays a plain log entry, edge-free.
 */
function findSpawners(
  closed: Ticket[],
  parentsOf: Map<number, number[]>,
  hasDependents: Set<number>,
): Map<number, number> {
  const spawnerOf = new Map<number, number>()
  for (const ticket of closed) {
    if ((parentsOf.get(ticket.number) ?? []).length > 0) continue
    if (!hasDependents.has(ticket.number)) continue
    const spawner = closed
      .filter(
        (t) =>
          t.number !== ticket.number &&
          t.type !== 'research' &&
          t.closedAt !== null &&
          t.closedAt <= ticket.createdAt,
      )
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0) || b.number - a.number)[0]
    if (spawner) spawnerOf.set(ticket.number, spawner.number)
  }
  return spawnerOf
}

/** One drawn relation, lane-agnostic — `weave` decides these, paths come later. */
interface Link {
  kind: 'run' | 'merge' | 'fork'
  from: number
  to: number
  isDependency: boolean
}

interface Loom {
  laneOf: Map<number, number>
  laneCount: number
  links: Link[]
}

/** The weave's working state, threaded through its helpers. */
interface Shuttle {
  posOf: Map<number, number>
  /** Drawn dependents not yet placed, per ticket — a lane frees when its tip's count hits 0. */
  pending: Map<number, number>
  laneOf: Map<number, number>
  /** Per lane: null while a thread holds it, else the position it has been clear since. */
  freeSince: (number | null)[]
  links: Link[]
  spawnerOf: Map<number, number>
}

/**
 * Where a ticket sits: it inherits the leftmost lane whose thread ends with it, or takes the
 * leftmost free lane. A thread whose spawner fork must reach back down only takes a lane that
 * has been clear that far, so no stroke ever crosses a node it doesn't touch.
 */
function chooseLane(s: Shuttle, ticket: Ticket, pos: number, parents: number[]): number {
  const ending = parents.filter((p) => s.pending.get(p) === 1)
  if (ending.length > 0) return Math.min(...ending.map((p) => s.laneOf.get(p) ?? 0))
  const spawner = s.spawnerOf.get(ticket.number)
  const clearFrom = spawner !== undefined ? (s.posOf.get(spawner) ?? pos) : pos
  const lane = s.freeSince.findIndex((p) => p !== null && p <= clearFrom)
  if (lane !== -1) return lane
  s.freeSince.push(null)
  return s.freeSince.length - 1
}

/** Link a placed ticket to its drawn blockers: a rail up the inherited lane, merges otherwise —
 * and free every blocker lane whose thread this ticket consumed. */
function linkParents(s: Shuttle, to: number, lane: number, pos: number, parents: number[]): void {
  for (const p of parents) {
    s.links.push({
      kind: s.laneOf.get(p) === lane ? 'run' : 'merge',
      from: p,
      to,
      isDependency: true,
    })
    const left = (s.pending.get(p) ?? 1) - 1
    s.pending.set(p, left)
    const pLane = s.laneOf.get(p) ?? 0
    if (left === 0 && pLane !== lane) s.freeSince[pLane] = pos
  }
}

/** A spawned ticket's origin stroke. Anything else rootless simply starts where it stands —
 * a line to HEAD or the trunk would claim a dependency that does not exist. */
function linkOrigin(s: Shuttle, ticket: Ticket): void {
  const spawner = s.spawnerOf.get(ticket.number)
  if (spawner !== undefined) {
    s.links.push({ kind: 'fork', from: spawner, to: ticket.number, isDependency: false })
  }
}

/**
 * The single pass that lays the whole graph out — a commit-graph weave over the rows in road
 * order (position 0 at the bottom). Each placed ticket holds its lane as a live thread until its
 * last drawn dependent arrives; that dependent inherits the lane so the rail continues, every
 * other blocker bends in as a merge, and a freed lane returns to the pool for later threads to
 * reuse — the graph never grows a column while an old one sits empty.
 */
function weave(
  sequence: Ticket[],
  parentsOf: Map<number, number[]>,
  spawnerOf: Map<number, number>,
): Loom {
  const pending = new Map<number, number>()
  for (const parents of parentsOf.values()) {
    for (const p of parents) pending.set(p, (pending.get(p) ?? 0) + 1)
  }
  const s: Shuttle = {
    posOf: new Map(sequence.map((t, i) => [t.number, i])),
    pending,
    laneOf: new Map(),
    freeSince: [],
    links: [],
    spawnerOf,
  }

  for (const [pos, ticket] of sequence.entries()) {
    const t = ticket.number
    const parents = parentsOf.get(t) ?? []
    const lane = chooseLane(s, ticket, pos, parents)
    s.laneOf.set(t, lane)
    s.freeSince[lane] = null
    linkParents(s, t, lane, pos, parents)
    if (parents.length === 0) linkOrigin(s, ticket)
    // A closed dead end frees its lane; an undepended open ticket keeps holding it — its tip
    // still rises toward the fog, and nothing may be stacked into that line.
    if ((s.pending.get(t) ?? 0) === 0 && ticket.state === 'closed') s.freeSince[lane] = pos
  }

  return { laneOf: s.laneOf, laneCount: Math.max(s.freeSince.length, 2), links: s.links }
}

/**
 * The drawn parents per ticket: same-repo in-map blockers that sit below it in road order, minus
 * the ones a longer below-going chain already implies. Reduction runs on the below-going graph
 * itself, so an edge is only dropped when the path that replaces it is actually drawable.
 */
function reduceParents(sequence: Ticket[], blockersOf: Map<number, number[]>) {
  const posOf = new Map(sequence.map((t, i) => [t.number, i]))
  const below = new Map<number, number[]>()
  const downDependents = new Map<number, number[]>()
  for (const t of sequence) {
    const pos = posOf.get(t.number) ?? 0
    const parents = [...new Set(blockersOf.get(t.number) ?? [])].filter(
      (n) => (posOf.get(n) ?? Number.POSITIVE_INFINITY) < pos,
    )
    below.set(t.number, parents)
    for (const n of parents) {
      downDependents.set(n, [...(downDependents.get(n) ?? []), t.number])
    }
  }
  const parentsOf = new Map<number, number[]>()
  for (const t of sequence) {
    parentsOf.set(
      t.number,
      (below.get(t.number) ?? []).filter((n) => !isTransitive(n, t.number, downDependents)),
    )
  }
  const hasDependents = new Set<number>()
  for (const parents of parentsOf.values()) for (const n of parents) hasDependents.add(n)
  return { parentsOf, hasDependents }
}

/** Materialize the weave's links as svg paths, now that every ticket has a point. */
function buildEdges(links: Link[], pointOf: Map<number, Point>): LedgerEdge[] {
  const edges: LedgerEdge[] = []
  for (const link of links) {
    const to = pointOf.get(link.to)
    const from = pointOf.get(link.from)
    if (!to || !from) continue
    const path =
      link.kind === 'run'
        ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
        : link.kind === 'merge'
          ? connector(from, to)
          : forkConnector(from, to)
    edges.push({
      key: `${link.kind}-${link.from}-${link.to}`,
      kind: link.kind,
      from: link.from,
      to: link.to,
      isDependency: link.isDependency,
      path,
    })
  }
  return edges
}

/** Undepended open tickets — except the trunk's own top — dissolve toward the fog. */
function buildTipEdges(
  rows: LedgerRow[],
  hasDependents: Set<number>,
  trunkTopNumber: number | null,
  sepAhead: number,
): LedgerEdge[] {
  const edges: LedgerEdge[] = []
  for (const { ticket, x, y } of rows) {
    if (hasDependents.has(ticket.number) || ticket.number === trunkTopNumber) continue
    edges.push({
      key: `tip-${ticket.number}`,
      kind: 'tip',
      from: null,
      to: ticket.number,
      isDependency: false,
      path: `M ${x} ${y} L ${x} ${sepAhead + 26}`,
    })
  }
  return edges
}

export function buildLedger(map: WayfinderMap): Ledger {
  const home = map.nameWithOwner
  const { closed, ahead } = layerMap(map)
  const openNumbers = new Set(ahead.flat().map((t) => t.number))
  const orderedOpen = orderLayers(ahead, home, openNumbers).flat()

  const { blockersOf, dependentsOf } = buildRelations(
    map.tickets,
    home,
    new Set(map.tickets.map((t) => t.number)),
  )

  // Road order, bottom-up: oldest decision first, then the open layers takeable-first.
  const sequence = [...[...closed].reverse(), ...orderedOpen]
  const { parentsOf, hasDependents } = reduceParents(sequence, blockersOf)
  const spawnerOf = findSpawners(closed, parentsOf, hasDependents)
  const { laneOf, laneCount, links } = weave(sequence, parentsOf, spawnerOf)

  // Even spacing always: a weave past ten lanes narrows every lane by the same amount.
  const pitch = Math.min(PITCH, MAX_GUTTER / laneCount)
  const textX = GX + Math.max(laneCount * pitch, MIN_GUTTER_LANES * PITCH) + 44
  const laneX = (n: number) => GX + (laneOf.get(n) ?? 0) * pitch

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

  // With nothing charted the section disappears outright — no separator, no empty band — and
  // fog flows straight into ground covered.
  const sepBehind = sepAhead + (orderedOpen.length > 0 ? sectionHeight(orderedOpen.length) : 0)
  const rowY = (i: number) => sepBehind - SEC_BOTTOM - i * ROW_H

  const behindY = (j: number) => sepBehind + SEC_PAD + j * ROW_H
  const height = sepBehind + sectionHeight(closed.length) + PAD_BOTTOM

  const placeholders: { y: number; text: string }[] = []
  if (fogItems.length === 0) {
    const note = stripInlineMarkdown(map.body.notYetSpecifiedNote).trim()
    placeholders.push({ y: sepFog + SEC_PAD, text: note !== '' ? note : 'no fog recorded' })
  }
  if (closed.length === 0)
    placeholders.push({ y: sepBehind + SEC_PAD, text: 'nothing decided yet' })

  const rows: LedgerRow[] = orderedOpen.map((ticket, i) => ({
    ticket,
    x: laneX(ticket.number),
    y: rowY(i),
  }))
  const closedRows: ClosedRow[] = closed.map((ticket, j) => ({
    ticket,
    x: laneX(ticket.number),
    y: behindY(j),
  }))
  const head: Point = { x: GX, y: sepBehind }
  const pointOf = new Map<number, Point>(
    [...rows, ...closedRows].map((r) => [r.ticket.number, { x: r.x, y: r.y }]),
  )

  // Ghost stops scatter across the whole gutter — clear of the trunk, clear of the text column.
  const fogMin = GX + 26
  const fogMax = textX - 62
  const fogRows: FogRow[] = fogItems.map((item, i) => ({
    item,
    x: fogMin + ((i * 0.618 + 0.35) % 1) * (fogMax - fogMin),
    y: ghostY(i),
  }))

  // The trunk's dashed reach starts at the road's topmost open node when lane 0 carries one.
  const trunkTop = [...rows].reverse().find((r) => r.x === GX)
  const edges: LedgerEdge[] = [
    ...buildEdges(links, pointOf),
    ...buildTipEdges(rows, hasDependents, trunkTop?.ticket.number ?? null, sepAhead),
  ]

  const lastClosed = closedRows[closedRows.length - 1]
  const topTrunkClosed = closedRows.find((r) => r.x === GX)

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
    trunkDashed: { y1: trunkTop ? trunkTop.y : head.y, y2: destY + 14 },
    trunkSolid: lastClosed
      ? { y1: topTrunkClosed?.y ?? head.y, y2: lastClosed.y + ROW_H * 0.6 }
      : null,
    rows,
    closedRows,
    fogRows,
    placeholders,
    edges,
    blockersOf,
    dependentsOf,
  }
}
