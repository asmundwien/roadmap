/**
 * PROTOTYPE — throwaway. Variant J: tributaries — mainline-first, the confluence taken literally.
 *
 * The trunk does not end at HEAD: it continues as a dashed spine through the fog to the
 * destination — the future mainline. The heaviest chain of work occupies it; every other chain is
 * a tributary forked off HEAD that merges into a larger flow, never into an average. Joins are a
 * single 45° segment, the only bend grammar on the page, so the final visual statement is every
 * lane converging on where the trunk goes.
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
  PAD_TOP,
  StateMarker,
  Trunk,
  truncate,
  YOU_GAP,
} from './git-skeleton.tsx'
import type { VariantProps } from './variants.ts'

export const NAME = 'Tributaries'

const PITCH = 150

interface Placed {
  ticket: Ticket
  x: number
  y: number
  onSpine: boolean
  spineIndex: number
  ring: number
}

/** Join grammar: ride your rail, then exactly one 45° run onto the target. Rounded by linejoin. */
function joinUp(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.abs(to.x - from.x)
  if (dx < 1) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`
  const kneeY = to.y + dx
  if (kneeY >= from.y) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`
  return `M ${from.x} ${from.y} L ${from.x} ${kneeY} L ${to.x} ${to.y}`
}

/** Fork grammar: the mirror — one 45° run off the parent, then your own vertical rail. */
function forkOff(parent: { x: number; y: number }, railX: number, toY: number): string {
  const dx = Math.abs(railX - parent.x)
  if (dx < 1) return `M ${parent.x} ${parent.y} L ${railX} ${toY}`
  const kneeY = parent.y - dx
  if (kneeY <= toY) return `M ${parent.x} ${parent.y} L ${railX} ${toY}`
  return `M ${parent.x} ${parent.y} L ${railX} ${kneeY} L ${railX} ${toY}`
}

export function VariantJ({ map }: VariantProps) {
  const { closed, layers, chains, chainOf, depthOf, descCount } = decomposeChains(map)

  const frame = computeFrame(closed, Math.max(layers.length - 1, 0) * LAYER_STEP)
  const { you, fogBottom } = frame
  const yOf = (depth: number) => you.y - YOU_GAP - depth * LAYER_STEP

  // The spine's occupant: the heaviest chain forked off HEAD. Everything else is a tributary.
  const headChains = chains.filter((c) => c.forkFrom === null)
  const spine = [...headChains].sort(
    (a, b) =>
      chainWeight(b, descCount) - chainWeight(a, descCount) ||
      (a.tickets[0]?.number ?? 0) - (b.tickets[0]?.number ?? 0),
  )[0]
  const railX = new Map<Chain, number>()
  const ringOf = new Map<Chain, number>()
  if (spine) {
    railX.set(spine, CX)
    ringOf.set(spine, 0)
  }
  let slot = 0
  for (const chain of chains) {
    if (chain === spine) continue
    const ring = Math.floor(slot / 2) + 1
    const side = slot % 2 === 0 ? 1 : -1
    railX.set(chain, CX + side * ring * PITCH)
    ringOf.set(chain, ring)
    slot += 1
  }

  let spineCount = 0
  const placed: Placed[] = layers.flatMap((layer) =>
    layer.map((ticket) => {
      const chain = chainOf.get(ticket.number)
      const onSpine = chain === spine
      const p: Placed = {
        ticket,
        x: chain ? (railX.get(chain) ?? CX) : CX,
        y: yOf(depthOf.get(ticket.number) ?? 0),
        onSpine,
        spineIndex: onSpine ? spineCount : 0,
        ring: chain ? (ringOf.get(chain) ?? 1) : 1,
      }
      if (onSpine) spineCount += 1
      return p
    }),
  )
  const placedByNumber = new Map(placed.map((p) => [p.ticket.number, p]))
  const lastSpine = [...placed].reverse().find((p) => p.onSpine)

  return (
    <GitCanvas
      map={map}
      frame={frame}
      ariaLabel={`The confluence of ${map.title}, every lane joining the mainline`}
    >
      {/* the future mainline: the trunk's own lane, dashed, running through the fog to the flag */}
      <line
        x1={CX}
        y1={lastSpine ? lastSpine.y : you.y}
        x2={CX}
        y2={PAD_TOP + 34}
        stroke="var(--proto-muted)"
        strokeWidth="1.75"
        strokeOpacity="0.45"
        strokeDasharray="3 5"
        strokeLinecap="round"
      />

      <FogBand map={map} fogBottom={fogBottom} id="j-blur" />
      <DestinationPin map={map} />

      {/* joins: tributary rails ride vertical, then one 45° run into the flow they feed */}
      {placed.flatMap(({ ticket, x, y }) =>
        ticket.blockedBy
          .filter((b) => b.isOpen)
          .map((b) => {
            const from = placedByNumber.get(b.number)
            if (!from || Math.abs(from.x - x) < 1) return null
            return (
              <path
                key={`join-${ticket.number}-${b.number}`}
                d={joinUp(from, { x, y })}
                fill="none"
                stroke="var(--proto-muted)"
                strokeWidth="1.75"
                strokeOpacity="0.5"
                strokeDasharray="3 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          }),
      )}

      {/* forks and rails: each chain leaves its parent in one 45° run, then runs straight */}
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
              d={forkOff(parent, x, firstY)}
              fill="none"
              stroke={claimed ? 'var(--state-claimed)' : 'var(--proto-muted)'}
              strokeWidth="1.75"
              strokeOpacity={claimed ? 0.7 : 0.5}
              strokeDasharray={claimed ? '7 5' : '3 5'}
              strokeLinecap="round"
              strokeLinejoin="round"
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

      <Trunk frame={frame} map={map} />

      {placed.map((p) => (
        <TributaryNode key={p.ticket.number} placed={p} />
      ))}
    </GitCanvas>
  )
}

function TributaryNode({ placed }: { placed: Placed }) {
  const { ticket, x, y, onSpine, spineIndex, ring } = placed
  const meta = STATE_META[ticket.state]
  const login = ticket.assignees[0]?.login
  if (onSpine) {
    // Spine labels alternate sides like the trunk's waypoints — one continuous system.
    const side: 1 | -1 = spineIndex % 2 === 0 ? 1 : -1
    const anchor = side === 1 ? 'start' : 'end'
    return (
      <a href={ticket.url}>
        <title>{ticket.title}</title>
        <StateMarker ticket={ticket} x={x} y={y} />
        <text
          x={x + side * 18}
          y={y + 4}
          textAnchor={anchor}
          className={`d-node-title ${ticket.state === 'blocked' ? 'is-dim' : ''}`}
        >
          {truncate(ticket.title, 26)}
        </text>
        <text
          x={x + side * 18}
          y={y + 17}
          textAnchor={anchor}
          className="d-node-word"
          fill={meta.color}
        >
          {meta.glyph} {meta.word}
          {login !== undefined ? ` · ${login}` : ''}
        </text>
      </a>
    )
  }
  // Tributary labels centre on the rail; ring parity keeps x-adjacent rails off each other's line.
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
        {truncate(ticket.title, 26)}
      </text>
      <text x={x} y={wordY} textAnchor="middle" className="d-node-word" fill={meta.color}>
        {meta.glyph} {meta.word}
        {login !== undefined ? ` · ${login}` : ''}
      </text>
    </a>
  )
}
