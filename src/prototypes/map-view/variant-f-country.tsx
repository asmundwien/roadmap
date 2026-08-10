/**
 * PROTOTYPE — throwaway. Variant F: the country.
 *
 * Fog of war as the frame: a territory seen from above, revealed only where the effort has been.
 * One axis means forward — the route runs from the lower-left corner toward the destination pinned
 * upper-right. The walked route is a solid trail through its waypoints (the decisions, gists on
 * hover); charted-but-open tickets are landmarks ahead, reached by dotted not-yet-walked trails.
 * The charted country carries detail — small terrain marks, the portolan's honest edge — and past
 * it the fog owns the corner, with the destination held visible in a clearing beyond.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { MapHead, STATE_META } from './chrome.tsx'
import { layerMap, orderLayers } from './layout.ts'
import type { VariantProps } from './variants.ts'

export const NAME = 'The country'

const W = 1000
const H = 720
const START = { x: 90, y: 650 }
const END = { x: 915, y: 85 }

const DX = END.x - START.x
const DY = END.y - START.y
const LEN = Math.hypot(DX, DY)
const U = { x: DX / LEN, y: DY / LEN }
const N = { x: -DY / LEN, y: DX / LEN }

function at(t: number, off: number): { x: number; y: number } {
  return {
    x: START.x + U.x * t * LEN + N.x * off,
    y: START.y + U.y * t * LEN + N.y * off,
  }
}

/** Deterministic noise in [-1, 1] — stable geography across renders, no Math.random. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

interface Placed {
  ticket: Ticket
  x: number
  y: number
  /** Which side of the travel axis the landmark sits on — its label goes further out. */
  side: 1 | -1
}

export function VariantF({ map }: VariantProps) {
  const { closed, ahead } = layerMap(map)
  const gistByTitle = new Map(map.body.decisions.map((d) => [d.title, d.gist]))

  // Steps along the axis: the walked stretch, one per charted layer, then fog, then destination.
  const total = closed.length + ahead.length + 2

  const waypoints = closed.map((ticket, i) => ({
    ticket,
    ...at((i + 1) / total, Math.sin(i * 1.7) * 46),
  }))
  const you = at((closed.length + 0.55) / total, Math.sin(closed.length * 1.7) * 30)

  const placed: Placed[] = orderLayers(ahead).flatMap((sorted, depth) => {
    const spread = Math.min(118, 440 / Math.max(sorted.length, 1))
    return sorted.map((ticket, i) => {
      const off = (i - (sorted.length - 1) / 2) * spread + jitter(ticket.number) * 8
      const side: 1 | -1 = off >= 0 ? 1 : -1
      return { ticket, side, ...at((closed.length + 1 + depth) / total, off) }
    })
  })
  const placedByNumber = new Map(placed.map((p) => [p.ticket.number, p]))

  const chartedT = (closed.length + ahead.length + 0.45) / total

  // Terrain detail only where the country is charted — the portolan's honest edge.
  const hills = Array.from({ length: 46 }, (_, i) => {
    const t = 0.02 + ((jitter(i * 2 + 1) + 1) / 2) * (chartedT - 0.06)
    const off = jitter(i * 3 + 2) * 250
    return { key: i, ...at(t, off) }
  }).filter((p) => p.x > 20 && p.x < W - 20 && p.y > 40 && p.y < H - 16)

  const fogBlobs = [
    ...map.body.notYetSpecified.map((item, i) => ({
      key: item,
      item,
      ...at(chartedT + 0.06 + ((i * 0.618 + 0.2) % 1) * (0.92 - chartedT), jitter(i + 9) * 180),
      rx: 95 + ((jitter(i + 3) + 1) / 2) * 55,
      ry: 42 + ((jitter(i + 17) + 1) / 2) * 22,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      key: `wisp-${i}`,
      item: null,
      ...at(chartedT + 0.08 + (i / 6) * (0.97 - chartedT), jitter(i + 27) * 260),
      rx: 130,
      ry: 46,
    })),
  ]

  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const mx = (a.x + b.x) / 2 + N.x * 12
    const my = (a.y + b.y) / 2 + N.y * 12
    return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`
  }

  return (
    <div>
      <MapHead map={map} />
      <div className="f-wrap">
        <svg
          className="f-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`The country of ${map.title}, travelled toward the upper right`}
        >
          <title>{map.title}</title>
          <defs>
            <filter id="f-blur" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="16" />
            </filter>
          </defs>

          {hills.map((hill) => (
            <path
              key={hill.key}
              d={`M ${hill.x - 6} ${hill.y} q 6 -7 12 0`}
              fill="none"
              stroke="var(--proto-muted)"
              strokeOpacity="0.4"
              strokeWidth="1.25"
            />
          ))}

          {/* not-yet-walked trails: to the frontier from here, and up each open prerequisite */}
          {placed
            .filter(({ ticket }) => !ticket.isBlocked)
            .map(({ ticket, x, y }) => (
              <path
                key={`stub-${ticket.number}`}
                d={curve(you, { x, y })}
                fill="none"
                stroke={ticket.state === 'claimed' ? 'var(--state-claimed)' : 'var(--proto-muted)'}
                strokeWidth="1.75"
                strokeOpacity="0.6"
                strokeDasharray={ticket.state === 'claimed' ? '7 5' : '2 6'}
                strokeLinecap="round"
              />
            ))}
          {placed.flatMap(({ ticket, x, y }) =>
            ticket.blockedBy
              .filter((b) => b.isOpen)
              .map((b) => {
                const from = placedByNumber.get(b.number)
                if (!from) return null
                return (
                  <path
                    key={`${ticket.number}-${b.number}`}
                    d={curve(from, { x, y })}
                    fill="none"
                    stroke="var(--proto-muted)"
                    strokeWidth="1.5"
                    strokeOpacity="0.4"
                    strokeDasharray="2 6"
                    strokeLinecap="round"
                  />
                )
              }),
          )}

          {/* the walked trail — solid, thickening with what it carried */}
          {waypoints.map((wp, i) => {
            const prev = i === 0 ? at(0.35 / total, 10) : waypoints[i - 1]
            if (!prev) return null
            return (
              <path
                key={`trail-${wp.ticket.number}`}
                d={curve(prev, wp)}
                fill="none"
                stroke="var(--proto-ink)"
                strokeOpacity="0.55"
                strokeWidth={2 + i * 0.35}
                strokeLinecap="round"
              />
            )
          })}
          {(() => {
            const last = waypoints[waypoints.length - 1]
            return last ? (
              <path
                d={curve(last, you)}
                fill="none"
                stroke="var(--proto-ink)"
                strokeOpacity="0.55"
                strokeWidth={2 + waypoints.length * 0.35}
                strokeLinecap="round"
              />
            ) : null
          })()}
          {waypoints.map((wp, i) => (
            <a key={wp.ticket.number} href={wp.ticket.url}>
              <circle cx={wp.x} cy={wp.y} r="5.5" fill="var(--proto-ink)" fillOpacity="0.7">
                <title>
                  {wp.ticket.title}
                  {gistByTitle.has(wp.ticket.title) ? ` — ${gistByTitle.get(wp.ticket.title)}` : ''}
                </title>
              </circle>
              <text
                x={wp.x + (Math.sin(i * 1.7) >= 0 ? -12 : 12)}
                y={wp.y + (Math.sin(i * 1.7) >= 0 ? 18 : -10)}
                textAnchor={Math.sin(i * 1.7) >= 0 ? 'end' : 'start'}
                className="f-waypoint"
              >
                {truncate(wp.ticket.title, 30)}
              </text>
            </a>
          ))}

          <text x={you.x} y={you.y + 5} textAnchor="middle" className="f-you">
            ▲
          </text>
          <text x={you.x + 13} y={you.y + 5} textAnchor="start" className="f-you-label">
            you are here
          </text>

          {placed.map((p) => (
            <Landmark key={p.ticket.number} placed={p} />
          ))}

          {/* the fog owns the far corner — dim, unlabelled; items surface on hover */}
          <g filter="url(#f-blur)">
            {fogBlobs.map((blob) => (
              <ellipse
                key={blob.key}
                cx={blob.x}
                cy={blob.y}
                rx={blob.rx}
                ry={blob.ry}
                fill="var(--proto-ink)"
                fillOpacity={blob.item === null ? 0.08 : 0.13}
              >
                {blob.item !== null && <title>{blob.item}</title>}
              </ellipse>
            ))}
          </g>

          {/* the destination — a clearing in the fog, always visible */}
          <circle
            cx={END.x - 25}
            cy={END.y + 10}
            r="88"
            fill="var(--proto-plane)"
            fillOpacity="0.8"
          />
          <text x={END.x} y={END.y} textAnchor="middle" className="f-flag">
            ⚑
          </text>
          <foreignObject x={END.x - 310} y={END.y + 14} width={300} height={110}>
            <p className="f-dest" title={map.body.destination}>
              {map.body.destination}
            </p>
          </foreignObject>
        </svg>
      </div>
    </div>
  )
}

function Landmark({ placed }: { placed: Placed }) {
  const { ticket, x, y, side } = placed
  const meta = STATE_META[ticket.state]
  const login = ticket.assignees[0]?.login

  return (
    <a href={ticket.url}>
      <title>{ticket.title}</title>
      {ticket.state === 'frontier' && (
        <>
          <circle cx={x} cy={y} r="16" fill={meta.color} fillOpacity="0.16" />
          <rect
            x={x - 7}
            y={y - 7}
            width="14"
            height="14"
            transform={`rotate(45 ${x} ${y})`}
            fill={meta.color}
          />
        </>
      )}
      {ticket.state === 'claimed' && (
        <>
          <circle
            cx={x}
            cy={y}
            r="8.5"
            fill="var(--proto-surface)"
            stroke={meta.color}
            strokeWidth="2.5"
          />
          <path d={`M ${x} ${y - 8.5} A 8.5 8.5 0 0 0 ${x} ${y + 8.5} Z`} fill={meta.color} />
        </>
      )}
      {ticket.state === 'blocked' && (
        <circle cx={x} cy={y} r="7" fill="var(--proto-plane)" stroke={meta.color} strokeWidth="2" />
      )}
      <text
        x={x + side * 17}
        y={y + 4}
        textAnchor={side === 1 ? 'start' : 'end'}
        className={`f-node-title ${ticket.state === 'blocked' ? 'is-dim' : ''}`}
      >
        {truncate(ticket.title, 28)}
      </text>
      <text
        x={x + side * 17}
        y={y + 17}
        textAnchor={side === 1 ? 'start' : 'end'}
        className="f-node-word"
        fill={meta.color}
      >
        {meta.glyph} {meta.word}
        {login !== undefined ? ` · ${login}` : ''}
      </text>
    </a>
  )
}
