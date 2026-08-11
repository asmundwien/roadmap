/**
 * PROTOTYPE — throwaway. Variant H: rails-and-sidings — commit-graph orthodoxy transplanted.
 *
 * The research's first recommendation (docs/research/commit-graph-layouts.md): branches own
 * persistent vertical rails allocated centre-out at fixed pitch, heaviest chains innermost; all
 * curvature lives in short connectors at forks and merges; a merge sits ON the rail of its
 * heaviest incoming chain and the other rails visibly retire into it. Between events, geometry is
 * a dead-straight vertical — a bend must mean something happened.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { type Chain, chainWeight, decomposeChains } from './chains.ts'
import { STATE_META } from './chrome.tsx'
import {
  CX,
  computeFrame,
  DestinationPin,
  FogBand,
  GitCanvas,
  LAYER_STEP,
  StateMarker,
  Trunk,
  truncate,
  YOU_GAP,
} from './git-skeleton.tsx'
import type { VariantProps } from './variants.ts'

export const NAME = 'Rails and sidings'

const PITCH = 145
const BEND = 44

interface Placed {
  ticket: Ticket
  x: number
  y: number
  ring: number
}

/** Connector bend scaled to the crossing: wide jumps arrive steeply, never tangentially. */
function bendFor(dx: number): number {
  return Math.min(96, Math.max(BEND, dx * 0.5))
}

/** Fork connector: leave the parent, bend once onto the rail, then it is the rail's business. */
function forkPath(p: { x: number; y: number }, railX: number, toY: number): string {
  if (Math.abs(p.x - railX) < 1) return `M ${p.x} ${p.y} L ${railX} ${toY}`
  const bend = bendFor(Math.abs(p.x - railX))
  return [
    `M ${p.x} ${p.y}`,
    `C ${p.x} ${p.y - bend * 0.65}, ${railX} ${p.y - bend * 0.35}, ${railX} ${p.y - bend}`,
    `L ${railX} ${toY}`,
  ].join(' ')
}

/** Merge connector: ride the rail straight, bend once just before the surviving rail's node. */
function mergePath(b: { x: number; y: number }, t: { x: number; y: number }): string {
  if (Math.abs(b.x - t.x) < 1) return `M ${b.x} ${b.y} L ${t.x} ${t.y}`
  const bend = bendFor(Math.abs(b.x - t.x))
  return [
    `M ${b.x} ${b.y}`,
    `L ${b.x} ${t.y + bend}`,
    `C ${b.x} ${t.y + bend * 0.35}, ${t.x} ${t.y + bend * 0.65}, ${t.x} ${t.y}`,
  ].join(' ')
}

export function VariantH({ map }: VariantProps) {
  const work = decomposeChains(map)
  const { closed, layers, chains, chainOf, depthOf, descCount } = work

  const frame = computeFrame(closed, Math.max(layers.length - 1, 0) * LAYER_STEP)
  const { you, fogBottom } = frame
  const yOf = (depth: number) => you.y - YOU_GAP - depth * LAYER_STEP

  // Centre-out slots at fixed pitch, heaviest chains innermost — decided once, stable forever.
  const bySlot = [...chains].sort(
    (a, b) =>
      chainWeight(b, descCount) - chainWeight(a, descCount) ||
      (a.tickets[0]?.number ?? 0) - (b.tickets[0]?.number ?? 0),
  )
  const railX = new Map<Chain, number>()
  const ringOf = new Map<Chain, number>()
  for (const [i, chain] of bySlot.entries()) {
    const ring = Math.floor(i / 2) + 1
    const side = i % 2 === 0 ? 1 : -1
    railX.set(chain, CX + side * ring * PITCH)
    ringOf.set(chain, ring)
  }

  const placed: Placed[] = layers.flatMap((layer) =>
    layer.map((ticket) => {
      const chain = chainOf.get(ticket.number)
      return {
        ticket,
        x: chain ? (railX.get(chain) ?? CX) : CX,
        y: yOf(depthOf.get(ticket.number) ?? 0),
        ring: chain ? (ringOf.get(chain) ?? 1) : 1,
      }
    }),
  )
  const placedByNumber = new Map(placed.map((p) => [p.ticket.number, p]))

  const dependedOn = new Set(
    placed.flatMap((p) => p.ticket.blockedBy.filter((b) => b.isOpen).map((b) => b.number)),
  )

  return (
    <GitCanvas map={map} frame={frame} ariaLabel={`The rails of ${map.title}, read bottom to top`}>
      <FogBand map={map} fogBottom={fogBottom} id="h-blur" />
      <DestinationPin map={map} />

      {/* charted tips trail off toward the destination, dissolving where the fog begins */}
      {placed
        .filter((p) => !dependedOn.has(p.ticket.number))
        .map(({ ticket, x, y }) => (
          <path
            key={`tip-${ticket.number}`}
            d={`M ${x} ${y} C ${x} ${y - 60}, ${x + (CX - x) * 0.4} ${fogBottom + 60}, ${x + (CX - x) * 0.55} ${fogBottom + 6}`}
            fill="none"
            stroke="var(--proto-muted)"
            strokeWidth="1.5"
            strokeOpacity="0.22"
            strokeDasharray="3 6"
            strokeLinecap="round"
          />
        ))}

      {/* the rails: one fork connector each, then dead-straight dashes through their tickets */}
      {chains.map((chain) => {
        const first = chain.tickets[0]
        const last = chain.tickets[chain.tickets.length - 1]
        if (!first || !last) return null
        const x = railX.get(chain) ?? CX
        const parent = chain.forkFrom === null ? you : (placedByNumber.get(chain.forkFrom) ?? you)
        const firstY = yOf(depthOf.get(first.number) ?? 0)
        const lastY = yOf(depthOf.get(last.number) ?? 0)
        const claimed = first.state === 'claimed'
        return (
          <g key={`rail-${chain.id}`}>
            <path
              d={forkPath(parent, x, firstY)}
              fill="none"
              stroke={claimed ? 'var(--state-claimed)' : 'var(--proto-muted)'}
              strokeWidth="1.75"
              strokeOpacity={claimed ? 0.7 : 0.5}
              strokeDasharray={claimed ? '7 5' : '3 5'}
              strokeLinecap="round"
            />
            {lastY < firstY && (
              <line
                x1={x}
                y1={firstY}
                x2={x}
                y2={lastY}
                stroke="var(--proto-muted)"
                strokeWidth="1.75"
                strokeOpacity="0.5"
                strokeDasharray="3 5"
                strokeLinecap="round"
              />
            )}
          </g>
        )
      })}

      {/* merges: foreign rails ride straight, bend once, and retire into the surviving rail */}
      {placed.flatMap(({ ticket, x, y }) =>
        ticket.blockedBy
          .filter((b) => b.isOpen)
          .map((b) => {
            const from = placedByNumber.get(b.number)
            if (!from || Math.abs(from.x - x) < 1) return null
            return (
              <path
                key={`merge-${ticket.number}-${b.number}`}
                d={mergePath(from, { x, y })}
                fill="none"
                stroke="var(--proto-muted)"
                strokeWidth="1.75"
                strokeOpacity="0.5"
                strokeDasharray="3 5"
                strokeLinecap="round"
              />
            )
          }),
      )}

      <Trunk frame={frame} map={map} />

      {placed.map((p) => (
        <RailNode key={p.ticket.number} placed={p} />
      ))}
    </GitCanvas>
  )
}

function RailNode({ placed }: { placed: Placed }) {
  const { ticket, x, y, ring } = placed
  const meta = STATE_META[ticket.state]
  const login = ticket.assignees[0]?.login
  // Centred under (or over) the node — the rail's one stable label address. Ring parity breaks
  // rows: rails adjacent in x always differ in ring on the same side.
  const above = ring % 2 === 0
  const titleY = above ? y - 32 : y + 24
  const wordY = above ? y - 19 : y + 38
  return (
    <a href={ticket.url}>
      <title>{ticket.title}</title>
      <StateMarker ticket={ticket} x={x} y={y} />
      <text
        x={x}
        y={titleY}
        textAnchor="middle"
        className={`d-node-title ${ticket.state === 'blocked' ? 'is-dim' : ''}`}
      >
        {truncate(ticket.title, 24)}
      </text>
      <text x={x} y={wordY} textAnchor="middle" className="d-node-word" fill={meta.color}>
        {meta.glyph} {meta.word}
        {login !== undefined ? ` · ${login}` : ''}
      </text>
    </a>
  )
}
