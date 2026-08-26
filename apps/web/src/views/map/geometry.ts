import { type ProjectKey, type Ticket, ticketTypeOf, type WayfinderMap } from '@roadmap/contracts'
import { stripInlineMarkdown } from '../gist.ts'

/**
 * The unified-ledger geometry — everything the map screen draws, computed as plain data.
 *
 * The whole map is ONE graph. Rows run in road order — oldest decision at the bottom, newest at
 * HEAD, then the open work by distance-from-takeable up to the fog — and a single commit-graph
 * weave lays every ticket out, ground covered and charted ahead alike; the "ground covered"
 * boundary is a separator line the threads simply cross. The weave follows the commit-graph
 * research: a placed ticket holds its lane until its last drawn dependent arrives, that dependent
 * inherits the lane so the rail continues, other blockers bend in as merges, and freed lanes
 * return to a pool for later threads — the graph reuses its whitespace instead of growing a new
 * column per branch. Reservation is also what keeps the picture honest: an edge only ever rides a
 * lane its blocker holds, so no line can pass through a node it doesn't touch. Everything is
 * deterministic by construction — same snapshot, same picture — which is what keeps the poll from
 * reshuffling the map underfoot.
 *
 * Merges obey the Hasse rule: a blocked-by that a longer chain of drawn edges already implies is
 * not drawn again, so the picture carries the dependency order without restating every shortcut a
 * source happens to know about — hover still walks the full graph; reduction trims ink, not truth.
 *
 * Cross-project blocked-by edges never become geometry: ticket ids only identify a ticket within
 * one project, so a foreign blocker counts one step of depth (the ticket really is blocked) but is
 * never followed, drawn, or offered as a hover neighbour.
 *
 * Origins: a rootless closed ticket that other work depends on forks off the ticket whose
 * resolution spawned it — wayfinder fires research subagents from the session that just closed
 * something, and creation time identifies that something. Anything else rootless simply starts
 * where it stands, edge-free: a stroke to HEAD or the trunk would claim a dependency that does not
 * exist, and a node without recorded relations honestly has none.
 */

/** The ledger renders at a fixed 1.25× its 900-unit viewBox. */
export const LEDGER_SCALE = 1.25

const W = 900
const GX = 44
const PITCH = 34
const MIN_GUTTER_LANES = 4
const MAX_GUTTER = 10 * PITCH
const ROW_H = 52
const THIN_ROW_H = 40
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
  kind: 'fork' | 'run' | 'merge' | 'tip'
  from: string | null
  to: string
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
  trunkDashed: { y1: number; y2: number }
  trunkSolid: { y1: number; y2: number } | null
  rows: LedgerRow[]
  closedRows: ClosedRow[]
  fogRows: FogRow[]
  placeholders: { y: number; text: string }[]
  edges: LedgerEdge[]
  blockersOf: Map<string, string[]>
  dependentsOf: Map<string, string[]>
}

interface Point {
  x: number
  y: number
}

function connector(a: Point, b: Point): string {
  if (Math.abs(a.x - b.x) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  return [
    `M ${a.x} ${a.y}`,
    `L ${a.x} ${b.y + BEND}`,
    `C ${a.x} ${b.y + BEND * 0.35}, ${b.x} ${b.y + BEND * 0.65}, ${b.x} ${b.y}`,
  ].join(' ')
}

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
function openInMapBlockers(ticket: Ticket, home: ProjectKey, openIds: Set<string>): string[] {
  return ticket.blockedBy
    .filter(
      (blocker) =>
        blocker.state !== 'closed' &&
        sameProject(blocker.project, home) &&
        openIds.has(blocker.ticketId),
    )
    .map((blocker) => blocker.ticketId)
}

/**
 * The longest chain of still-open blockers between a ticket and being takeable. 0 means takeable
 * now. Closed blockers count for nothing — that route is walked. A cross-project open blocker
 * counts one step (the ticket is blocked) but is never followed.
 */
export function openDepth(ticket: Ticket, byId: Map<string, Ticket>, home: ProjectKey): number {
  const seen = new Set<string>()
  const walk = (current: Ticket): number => {
    if (seen.has(current.id)) return 0
    seen.add(current.id)
    let deepest = 0
    for (const blocker of current.blockedBy) {
      if (blocker.state === 'closed') continue
      const upstream = sameProject(blocker.project, home) ? byId.get(blocker.ticketId) : undefined
      deepest = Math.max(deepest, 1 + (upstream ? walk(upstream) : 0))
    }
    seen.delete(current.id)
    return deepest
  }
  return walk(ticket)
}

interface Layered {
  closed: Ticket[]
  ahead: Ticket[][]
}

function layerMap(map: WayfinderMap): Layered {
  const byId = new Map(map.tickets.map((ticket) => [ticket.id, ticket]))
  const closed = map.tickets
    .filter((ticket) => ticket.state === 'closed')
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  const open = map.tickets.filter((ticket) => ticket.state !== 'closed')

  const maxDepth = open.reduce(
    (max, ticket) => Math.max(max, openDepth(ticket, byId, map.project)),
    0,
  )
  const ahead: Ticket[][] = Array.from({ length: maxDepth + 1 }, () => [])
  for (const ticket of open) ahead[openDepth(ticket, byId, map.project)]?.push(ticket)

  return { closed, ahead }
}

function orderLayers(
  ahead: Ticket[][],
  home: ProjectKey,
  openIds: Set<string>,
  ticketOrder: Map<string, number>,
): Ticket[][] {
  const slot = new Map<string, number>()
  const byOrder = (ticket: Ticket) => ticketOrder.get(ticket.id) ?? Number.MAX_SAFE_INTEGER
  return ahead.map((layer, depth) => {
    const sorted = [...layer].sort((a, b) => byOrder(a) - byOrder(b))
    if (depth > 0) {
      const key = (ticket: Ticket): number => {
        const upstream = openInMapBlockers(ticket, home, openIds).filter((id) => slot.has(id))
        if (upstream.length === 0) return 0.5
        return upstream.reduce((sum, id) => sum + (slot.get(id) ?? 0.5), 0) / upstream.length
      }
      sorted.sort((a, b) => key(a) - key(b) || byOrder(a) - byOrder(b))
    }
    sorted.forEach((ticket, index) => {
      slot.set(ticket.id, sorted.length === 1 ? 0.5 : index / (sorted.length - 1))
    })
    return sorted
  })
}

/** The raw same-project in-map blocked-by graph, both directions — what hover walks. */
function buildRelations(
  tickets: Ticket[],
  home: ProjectKey,
  inMap: Set<string>,
): { blockersOf: Map<string, string[]>; dependentsOf: Map<string, string[]> } {
  const blockersOf = new Map<string, string[]>()
  const dependentsOf = new Map<string, string[]>()
  for (const ticket of tickets) {
    for (const blocker of ticket.blockedBy) {
      if (!sameProject(blocker.project, home) || !inMap.has(blocker.ticketId)) continue
      blockersOf.set(ticket.id, [...(blockersOf.get(ticket.id) ?? []), blocker.ticketId])
      dependentsOf.set(blocker.ticketId, [...(dependentsOf.get(blocker.ticketId) ?? []), ticket.id])
    }
  }
  return { blockersOf, dependentsOf }
}

function isTransitive(from: string, to: string, dependentsOf: Map<string, string[]>): boolean {
  const seen = new Set<string>([from])
  const stack = (dependentsOf.get(from) ?? []).filter((id) => id !== to)
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    for (const dependent of dependentsOf.get(id) ?? []) {
      if (dependent === to) return true
      stack.push(dependent)
    }
  }
  return false
}

function findSpawners(
  closed: Ticket[],
  parentsOf: Map<string, string[]>,
  hasDependents: Set<string>,
  ticketOrder: Map<string, number>,
): Map<string, string> {
  const spawnerOf = new Map<string, string>()
  const byOrder = (ticket: Ticket) => ticketOrder.get(ticket.id) ?? Number.MAX_SAFE_INTEGER
  for (const ticket of closed) {
    if ((parentsOf.get(ticket.id) ?? []).length > 0) continue
    if (!hasDependents.has(ticket.id)) continue
    const createdAt = ticket.createdAt
    if (createdAt === undefined) continue
    const spawner = closed
      .filter(
        (candidate) =>
          candidate.id !== ticket.id &&
          ticketTypeOf(candidate.typeEvidence) !== 'research' &&
          candidate.closedAt !== undefined &&
          candidate.closedAt <= createdAt,
      )
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0) || byOrder(b) - byOrder(a))[0]
    if (spawner) spawnerOf.set(ticket.id, spawner.id)
  }
  return spawnerOf
}

interface Link {
  kind: 'run' | 'merge' | 'fork'
  from: string
  to: string
  isDependency: boolean
}

interface Loom {
  laneOf: Map<string, number>
  laneCount: number
  links: Link[]
}

interface Shuttle {
  posOf: Map<string, number>
  pending: Map<string, number>
  laneOf: Map<string, number>
  freeSince: (number | null)[]
  links: Link[]
  spawnerOf: Map<string, string>
}

function chooseLane(s: Shuttle, ticket: Ticket, pos: number, parents: string[]): number {
  const ending = parents.filter((parent) => s.pending.get(parent) === 1)
  if (ending.length > 0) return Math.min(...ending.map((parent) => s.laneOf.get(parent) ?? 0))
  const spawner = s.spawnerOf.get(ticket.id)
  const clearFrom = spawner !== undefined ? (s.posOf.get(spawner) ?? pos) : pos
  const lane = s.freeSince.findIndex((value) => value !== null && value <= clearFrom)
  if (lane !== -1) return lane
  s.freeSince.push(null)
  return s.freeSince.length - 1
}

function linkParents(s: Shuttle, to: string, lane: number, pos: number, parents: string[]): void {
  for (const parent of parents) {
    s.links.push({
      kind: s.laneOf.get(parent) === lane ? 'run' : 'merge',
      from: parent,
      to,
      isDependency: true,
    })
    const left = (s.pending.get(parent) ?? 1) - 1
    s.pending.set(parent, left)
    const parentLane = s.laneOf.get(parent) ?? 0
    if (left === 0 && parentLane !== lane) s.freeSince[parentLane] = pos
  }
}

function linkOrigin(s: Shuttle, ticket: Ticket): void {
  const spawner = s.spawnerOf.get(ticket.id)
  if (spawner !== undefined)
    s.links.push({ kind: 'fork', from: spawner, to: ticket.id, isDependency: false })
}

function weave(
  sequence: Ticket[],
  parentsOf: Map<string, string[]>,
  spawnerOf: Map<string, string>,
): Loom {
  const pending = new Map<string, number>()
  for (const parents of parentsOf.values()) {
    for (const parent of parents) pending.set(parent, (pending.get(parent) ?? 0) + 1)
  }
  const shuttle: Shuttle = {
    posOf: new Map(sequence.map((ticket, index) => [ticket.id, index])),
    pending,
    laneOf: new Map(),
    freeSince: [],
    links: [],
    spawnerOf,
  }

  for (const [pos, ticket] of sequence.entries()) {
    const id = ticket.id
    const parents = parentsOf.get(id) ?? []
    const lane = chooseLane(shuttle, ticket, pos, parents)
    shuttle.laneOf.set(id, lane)
    shuttle.freeSince[lane] = null
    linkParents(shuttle, id, lane, pos, parents)
    if (parents.length === 0) linkOrigin(shuttle, ticket)
    if ((shuttle.pending.get(id) ?? 0) === 0 && ticket.state === 'closed')
      shuttle.freeSince[lane] = pos
  }

  return {
    laneOf: shuttle.laneOf,
    laneCount: Math.max(shuttle.freeSince.length, 2),
    links: shuttle.links,
  }
}

function reduceParents(sequence: Ticket[], blockersOf: Map<string, string[]>) {
  const posOf = new Map(sequence.map((ticket, index) => [ticket.id, index]))
  const below = new Map<string, string[]>()
  const downDependents = new Map<string, string[]>()
  for (const ticket of sequence) {
    const pos = posOf.get(ticket.id) ?? 0
    const parents = [...new Set(blockersOf.get(ticket.id) ?? [])].filter(
      (id) => (posOf.get(id) ?? Number.POSITIVE_INFINITY) < pos,
    )
    below.set(ticket.id, parents)
    for (const id of parents) {
      downDependents.set(id, [...(downDependents.get(id) ?? []), ticket.id])
    }
  }
  const parentsOf = new Map<string, string[]>()
  for (const ticket of sequence) {
    parentsOf.set(
      ticket.id,
      (below.get(ticket.id) ?? []).filter((id) => !isTransitive(id, ticket.id, downDependents)),
    )
  }
  const hasDependents = new Set<string>()
  for (const parents of parentsOf.values()) for (const id of parents) hasDependents.add(id)
  return { parentsOf, hasDependents }
}

function buildEdges(links: Link[], pointOf: Map<string, Point>): LedgerEdge[] {
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

function buildTipEdges(
  rows: LedgerRow[],
  hasDependents: Set<string>,
  trunkTopId: string | null,
  sepAhead: number,
): LedgerEdge[] {
  const edges: LedgerEdge[] = []
  for (const { ticket, x, y } of rows) {
    if (hasDependents.has(ticket.id) || ticket.id === trunkTopId) continue
    edges.push({
      key: `tip-${ticket.id}`,
      kind: 'tip',
      from: null,
      to: ticket.id,
      isDependency: false,
      path: `M ${x} ${y} L ${x} ${sepAhead + 26}`,
    })
  }
  return edges
}

export function buildLedger(map: WayfinderMap): Ledger {
  const ticketOrder = new Map(map.tickets.map((ticket, index) => [ticket.id, index]))
  const { closed, ahead } = layerMap(map)
  const openIds = new Set(ahead.flat().map((ticket) => ticket.id))
  const orderedOpen = orderLayers(ahead, map.project, openIds, ticketOrder).flat()

  const { blockersOf, dependentsOf } = buildRelations(
    map.tickets,
    map.project,
    new Set(map.tickets.map((ticket) => ticket.id)),
  )

  const sequence = [...[...closed].reverse(), ...orderedOpen]
  const { parentsOf, hasDependents } = reduceParents(sequence, blockersOf)
  const spawnerOf = findSpawners(closed, parentsOf, hasDependents, ticketOrder)
  const { laneOf, laneCount, links } = weave(sequence, parentsOf, spawnerOf)

  const pitch = Math.min(PITCH, MAX_GUTTER / laneCount)
  const textX = GX + Math.max(laneCount * pitch, MIN_GUTTER_LANES * PITCH) + 44
  const laneX = (id: string) => GX + (laneOf.get(id) ?? 0) * pitch

  const destination = stripInlineMarkdown(map.body.destination)
  const colWidth = W - textX - 28
  const destLines = Math.min(4, Math.max(2, Math.ceil(destination.length / (colWidth / 7.4))))
  const destTextTop = PAD_TOP + 28
  const destY = destTextTop + 10
  const sepFog = destTextTop + destLines * DEST_LINE_H + 26

  const sectionHeight = (count: number, rowH: number) =>
    SEC_PAD + Math.max(count - 1, 0) * rowH + SEC_BOTTOM

  const fogItems = map.body.notYetSpecified.map(stripInlineMarkdown)
  const ghostY = (index: number) => sepFog + SEC_PAD + index * THIN_ROW_H
  const sepAhead = sepFog + sectionHeight(fogItems.length, THIN_ROW_H)
  const sepBehind =
    sepAhead + (orderedOpen.length > 0 ? sectionHeight(orderedOpen.length, ROW_H) : 0)
  const rowY = (index: number) => sepBehind - SEC_BOTTOM - index * ROW_H
  const behindY = (index: number) => sepBehind + SEC_PAD + index * THIN_ROW_H
  const height = sepBehind + sectionHeight(closed.length, THIN_ROW_H) + PAD_BOTTOM

  const placeholders: { y: number; text: string }[] = []
  if (fogItems.length === 0) {
    const note = stripInlineMarkdown(map.body.notYetSpecifiedNote).trim()
    placeholders.push({ y: sepFog + SEC_PAD, text: note !== '' ? note : 'no fog recorded' })
  }
  if (closed.length === 0)
    placeholders.push({ y: sepBehind + SEC_PAD, text: 'nothing decided yet' })

  const rows: LedgerRow[] = orderedOpen.map((ticket, index) => ({
    ticket,
    x: laneX(ticket.id),
    y: rowY(index),
  }))
  const closedRows: ClosedRow[] = closed.map((ticket, index) => ({
    ticket,
    x: laneX(ticket.id),
    y: behindY(index),
  }))
  const head: Point = { x: GX, y: sepBehind }
  const pointOf = new Map<string, Point>(
    [...rows, ...closedRows].map((row) => [row.ticket.id, { x: row.x, y: row.y }]),
  )

  const fogMin = GX + 26
  const fogMax = textX - 62
  const fogRows: FogRow[] = fogItems.map((item, index) => ({
    item,
    x: fogMin + ((index * 0.618 + 0.35) % 1) * (fogMax - fogMin),
    y: ghostY(index),
  }))

  const trunkTop = [...rows].reverse().find((row) => row.x === GX)
  const edges: LedgerEdge[] = [
    ...buildEdges(links, pointOf),
    ...buildTipEdges(rows, hasDependents, trunkTop?.ticket.id ?? null, sepAhead),
  ]

  const lastClosed = closedRows[closedRows.length - 1]
  const topTrunkClosed = closedRows.find((row) => row.x === GX)

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
      ? { y1: topTrunkClosed?.y ?? head.y, y2: lastClosed.y + THIN_ROW_H * 0.6 }
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

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
