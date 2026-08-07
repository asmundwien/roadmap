/**
 * PROTOTYPE — throwaway. Variant B: the terrain.
 *
 * Space is knownness, not topology. You stand at the bottom of a half-dome; ground already covered
 * sits close and dim, the frontier is the lit arc at the edge of your lamp, and every further layer
 * of blockers is another arc receding into fog. The dashed outer arc is the horizon — the
 * destination. Progress is read as how far up the dome the light reaches: no bar, no percentage.
 *
 * Closed tickets are drawn but not labelled. They are behind you; their titles are in the journal
 * down the side, and repeating them here only crowds the near ground.
 */

import type { Ticket, TicketState } from '../../wayfinder/types.ts'
import { MapHead, STATE_META } from './chrome.tsx'
import { layerMap } from './layout.ts'
import type { VariantProps } from './variants.ts'

export const NAME = 'Terrain & fog'

const VIEW_W = 1120
const VIEW_H = 660
const CX = 560
const CY = 618
const SQUASH = 0.97
const CLOSED_R = 120
const FIRST_RING = 200
const OUTER_RING = 455
const HORIZON = 555
const ARC_PAD = 0.3

interface Placed {
  ticket: Ticket
  x: number
  y: number
}

function placeRing(tickets: Ticket[], radius: number): Placed[] {
  const span = Math.PI - ARC_PAD * 2
  return tickets.map((ticket, i) => {
    const t = tickets.length === 1 ? 0.5 : i / (tickets.length - 1)
    const angle = Math.PI + ARC_PAD + span * t
    return {
      ticket,
      x: CX + SQUASH * radius * Math.cos(angle),
      y: CY + radius * Math.sin(angle),
    }
  })
}

/** Layer 0 always lands on the lamp's edge and the deepest always on the last arc, whatever N is. */
function ringRadius(depth: number, layers: number): number {
  if (layers <= 1) return FIRST_RING
  return FIRST_RING + (depth * (OUTER_RING - FIRST_RING)) / (layers - 1)
}

export function VariantB({ map }: VariantProps) {
  const { closed, ahead } = layerMap(map)

  const placed: Placed[] = [
    ...placeRing(closed, CLOSED_R),
    ...ahead.flatMap((layer, depth) => placeRing(layer, ringRadius(depth, ahead.length))),
  ]
  const byNumber = new Map(placed.map((p) => [p.ticket.number, p]))
  const arcs = [CLOSED_R, ...ahead.map((_, d) => ringRadius(d, ahead.length))]

  return (
    <div>
      <MapHead map={map} />
      <div className="b-wrap">
        <aside className="b-side">
          <h3>Ground covered · behind you</h3>
          <ul>
            {map.body.decisions.map((decision) => (
              <li key={decision.title}>
                <strong>{decision.title}</strong>
                <br />
                {decision.gist}
              </li>
            ))}
          </ul>
        </aside>

        <svg
          className="b-svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={`Map of ${map.title}`}
        >
          <title>{map.title}</title>
          <defs>
            <radialGradient
              id="fog"
              gradientUnits="userSpaceOnUse"
              cx={CX}
              cy={CY}
              r={HORIZON}
              gradientTransform={`translate(${CX * (1 - SQUASH)} 0) scale(${SQUASH} 1)`}
            >
              <stop offset="0.3" stopColor="var(--proto-plane)" stopOpacity="0" />
              <stop offset="0.66" stopColor="var(--proto-plane)" stopOpacity="0.32" />
              <stop offset="0.95" stopColor="var(--proto-plane)" stopOpacity="0.82" />
            </radialGradient>
          </defs>

          {/* half-arcs, not ellipses: each one lands on the ground line you are standing on */}
          {[...arcs, HORIZON].map((r) => (
            <path
              key={r}
              d={`M ${CX - SQUASH * r} ${CY} A ${SQUASH * r} ${r} 0 0 1 ${CX + SQUASH * r} ${CY}`}
              fill="none"
              stroke="var(--proto-hairline)"
              strokeDasharray={r === HORIZON ? '3 7' : undefined}
            />
          ))}
          <line
            x1={CX - SQUASH * HORIZON}
            y1={CY}
            x2={CX + SQUASH * HORIZON}
            y2={CY}
            stroke="var(--proto-hairline)"
          />

          {/* only open edges are drawn — a closed blocker is a road already walked */}
          {placed.flatMap(({ ticket, x, y }) =>
            ticket.blockedBy
              .filter((b) => b.isOpen)
              .map((b) => {
                const from = byNumber.get(b.number)
                if (!from) return null
                const mx = (from.x + x) / 2
                const my = (from.y + y) / 2
                return (
                  <path
                    key={`${ticket.number}-${b.number}`}
                    d={`M ${from.x} ${from.y} Q ${mx + (CX - mx) * 0.2} ${my + (CY - my) * 0.2} ${x} ${y}`}
                    fill="none"
                    stroke="var(--proto-muted)"
                    strokeWidth="2"
                    strokeOpacity="0.4"
                  />
                )
              }),
          )}

          {placed.map(({ ticket, x, y }) => (
            <Node key={ticket.number} ticket={ticket} x={x} y={y} />
          ))}

          <text x={CX} y={CY + 22} textAnchor="middle" className="b-node-label" fillOpacity="0.7">
            ▲ you are here
          </text>

          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#fog)" pointerEvents="none" />

          {/* the fog band: between the last thing we can name and the horizon */}
          {map.body.notYetSpecified.slice(0, 3).map((item, i) => (
            <text
              key={item}
              x={CX + (i - 1) * 300}
              y={84 + i * 24}
              textAnchor="middle"
              className="b-node-label"
              fillOpacity="0.6"
            >
              {truncate(item, 40)}
            </text>
          ))}
          <text x={CX} y="38" textAnchor="middle" className="b-node-label" fillOpacity="0.75">
            ── horizon · {truncate(map.body.destination, 84)} ──
          </text>
        </svg>
      </div>
    </div>
  )
}

/** Size carries the same signal the colour does — the frontier is the biggest thing on the dome. */
const NODE_RADIUS: Record<TicketState, number> = {
  frontier: 11,
  claimed: 9,
  blocked: 7,
  closed: 5,
}

function Node({ ticket, x, y }: { ticket: Ticket; x: number; y: number }) {
  const meta = STATE_META[ticket.state]
  const r = NODE_RADIUS[ticket.state]
  const isClosed = ticket.state === 'closed'
  const anchor = x < CX - 70 ? 'end' : x > CX + 70 ? 'start' : 'middle'
  const dx = anchor === 'end' ? -r - 7 : anchor === 'start' ? r + 7 : 0
  const dy = anchor === 'middle' ? -r - 9 : 4

  return (
    <a href={ticket.url}>
      {ticket.state === 'frontier' && (
        <circle cx={x} cy={y} r={r + 10} fill={meta.color} fillOpacity="0.18" />
      )}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={ticket.state === 'blocked' ? 'var(--proto-plane)' : meta.color}
        fillOpacity={isClosed ? 0.45 : 1}
        stroke={meta.color}
        strokeWidth="2.5"
        strokeOpacity={isClosed ? 0.6 : 1}
      />
      {!isClosed && (
        <text x={x + dx} y={y + dy} textAnchor={anchor} className="b-node-label">
          {truncate(ticket.title, 28)}
        </text>
      )}
    </a>
  )
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
