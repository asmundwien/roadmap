/**
 * PROTOTYPE — throwaway. Variant K: the ledger rail — the genre's own answer, as a control.
 *
 * Every real git tool pairs a narrow braid gutter with text in aligned rows (Sapling's smartlog is
 * the modern canon). This take adopts that wholesale for the region ahead of HEAD, keeping the
 * trunk, fog, and destination. It exists to test one assumption: does row alignment still trigger
 * the "list" genre-read once the journey furniture is present? If it doesn't, the criteria's
 * no-rows rule is miscalibrated. A control, not a favourite.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { type Chain, decomposeChains } from './chains.ts'
import { STATE_META } from './chrome.tsx'
import {
  CX,
  computeFrame,
  DestinationPin,
  FogBand,
  GitCanvas,
  StateMarker,
  Trunk,
  truncate,
  YOU_GAP,
} from './git-skeleton.tsx'
import type { VariantProps } from './variants.ts'

export const NAME = 'Ledger rail (control)'

const ROW_H = 54
const PITCH = 34
const BEND = 40

interface Row {
  ticket: Ticket
  x: number
  y: number
}

function connector(a: { x: number; y: number }, b: { x: number; y: number }): string {
  if (Math.abs(a.x - b.x) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  return [
    `M ${a.x} ${a.y}`,
    `L ${a.x} ${b.y + BEND}`,
    `C ${a.x} ${b.y + BEND * 0.35}, ${b.x} ${b.y + BEND * 0.65}, ${b.x} ${b.y}`,
  ].join(' ')
}

export function VariantK({ map }: VariantProps) {
  const { closed, layers, chains, chainOf, depthOf } = decomposeChains(map)

  // One row per open ticket: depth order, then lane order — the smartlog reading order.
  const laneIndex = new Map<Chain, number>()
  for (const [i, chain] of chains.entries()) laneIndex.set(chain, i)
  const laneOf = (n: number): number => {
    const chain = chainOf.get(n)
    return chain ? (laneIndex.get(chain) ?? 0) : 0
  }
  const laneX = (n: number): number => CX + laneOf(n) * PITCH

  const ordered = layers.flat()
  ordered.sort((a, b) => {
    const da = depthOf.get(a.number) ?? 0
    const db = depthOf.get(b.number) ?? 0
    if (da !== db) return da - db
    return laneOf(a.number) - laneOf(b.number) || a.number - b.number
  })

  const frame = computeFrame(closed, Math.max(ordered.length - 1, 0) * ROW_H)
  const { you, fogBottom } = frame

  const rows: Row[] = ordered.map((ticket, i) => ({
    ticket,
    x: laneX(ticket.number),
    y: you.y - YOU_GAP - i * ROW_H,
  }))
  const rowByNumber = new Map(rows.map((r) => [r.ticket.number, r]))
  const textX = CX + chains.length * PITCH + 34

  const dependedOn = new Set(
    rows.flatMap((r) => r.ticket.blockedBy.filter((b) => b.isOpen).map((b) => b.number)),
  )

  return (
    <GitCanvas
      map={map}
      frame={frame}
      ariaLabel={`The ledger of ${map.title}, a smartlog above HEAD`}
    >
      <FogBand map={map} fogBottom={fogBottom} id="k-blur" />
      <DestinationPin map={map} />

      {/* tips fade from the gutter into the fog */}
      {rows
        .filter((r) => !dependedOn.has(r.ticket.number))
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

      {/* the gutter braid: forks off HEAD, rails through rows, merges into surviving rails */}
      {chains.map((chain) => {
        const first = chain.tickets[0]
        const last = chain.tickets[chain.tickets.length - 1]
        if (!first || !last) return null
        const firstRow = rowByNumber.get(first.number)
        const lastRow = rowByNumber.get(last.number)
        if (!firstRow || !lastRow) return null
        const parent = chain.forkFrom === null ? you : (rowByNumber.get(chain.forkFrom) ?? you)
        const claimed = first.state === 'claimed'
        return (
          <g key={`rail-${chain.id}`}>
            <path
              d={connector({ x: parent.x, y: parent.y }, firstRow)}
              fill="none"
              stroke={claimed ? 'var(--state-claimed)' : 'var(--proto-muted)'}
              strokeWidth="1.75"
              strokeOpacity={claimed ? 0.7 : 0.5}
              strokeDasharray={claimed ? '7 5' : '3 5'}
              strokeLinecap="round"
            />
            {lastRow.y < firstRow.y && (
              <line
                x1={firstRow.x}
                y1={firstRow.y}
                x2={lastRow.x}
                y2={lastRow.y}
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
      {rows.flatMap(({ ticket, x, y }) =>
        ticket.blockedBy
          .filter((b) => b.isOpen)
          .map((b) => {
            const from = rowByNumber.get(b.number)
            if (!from || Math.abs(from.x - x) < 1) return null
            return (
              <path
                key={`merge-${ticket.number}-${b.number}`}
                d={connector(from, { x, y })}
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

      {rows.map(({ ticket, x, y }) => {
        const meta = STATE_META[ticket.state]
        const login = ticket.assignees[0]?.login
        return (
          <a key={ticket.number} href={ticket.url}>
            <title>{ticket.title}</title>
            <StateMarker ticket={ticket} x={x} y={y} />
            <text
              x={textX}
              y={y + 4}
              textAnchor="start"
              className={`k-row-title ${ticket.state === 'blocked' ? 'is-dim' : ''}`}
            >
              {truncate(ticket.title, 42)}
            </text>
            <text x={textX} y={y + 19} textAnchor="start" className="d-node-word" fill={meta.color}>
              {meta.glyph} {meta.word}
              {login !== undefined ? ` · ${login}` : ''}
            </text>
          </a>
        )
      })}
    </GitCanvas>
  )
}
