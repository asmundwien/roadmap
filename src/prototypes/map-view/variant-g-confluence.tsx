/**
 * PROTOTYPE — throwaway. Variant G: the confluence — the map drawn as a git history.
 *
 * The trunk below is the history already merged: every decision a commit, the line thickening as
 * it accumulates. The traveller is HEAD. Ahead, the frontier forks into parallel branches — one
 * lane per takeable or claimed ticket — and blocked tickets are the merge points where those
 * branches must come together before work can continue. Rails ahead are dashed: branches that do
 * not exist yet. Past the last charted merge the lanes dissolve into fog, and the destination is
 * pinned above it — the final merge every lane is travelling toward.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { MapHead, STATE_META } from './chrome.tsx'
import { layerMap, orderLayers } from './layout.ts'
import type { VariantProps } from './variants.ts'

export const NAME = 'The confluence (git)'

const W = 1000
const CX = W / 2
const PAD_TOP = 16
const DEST_H = 104
const FOG_H = 140
const GAP_FOG = 56
const LAYER_STEP = 112
const YOU_GAP = 72
const TRACE_STEP = 44
const PAD_BOTTOM = 40
const LANE_GAP = 132

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

interface Placed {
  ticket: Ticket
  x: number
  y: number
  labelAbove: boolean
}

/** A rail between two points on the braid: a quick S-bend at the source, then a straight lane. */
function rail(a: { x: number; y: number }, b: { x: number; y: number }): string {
  if (Math.abs(a.x - b.x) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  const bend = Math.min(68, (a.y - b.y) * 0.65)
  return [
    `M ${a.x} ${a.y}`,
    `C ${a.x} ${a.y - bend * 0.7}, ${b.x} ${a.y - bend * 0.35}, ${b.x} ${a.y - bend}`,
    `L ${b.x} ${b.y}`,
  ].join(' ')
}

/** Nudge same-layer lanes apart until every pair clears LANE_GAP, staying inside the canvas. */
function spaceLanes(desired: number[]): number[] {
  const order = desired.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x)
  for (let pass = 0; pass < 6; pass += 1) {
    for (let k = 1; k < order.length; k += 1) {
      const prev = order[k - 1]
      const here = order[k]
      if (prev && here && here.x - prev.x < LANE_GAP) {
        const push = (LANE_GAP - (here.x - prev.x)) / 2
        prev.x -= push
        here.x += push
      }
    }
  }
  const spaced = new Array<number>(desired.length)
  for (const { x, i } of order) spaced[i] = Math.max(120, Math.min(W - 120, x))
  return spaced
}

export function VariantG({ map }: VariantProps) {
  const { closed, ahead } = layerMap(map)
  const layers = ahead.length
  const gistByTitle = new Map(map.body.decisions.map((d) => [d.title, d.gist]))

  const H =
    PAD_TOP +
    DEST_H +
    FOG_H +
    GAP_FOG +
    Math.max(layers - 1, 0) * LAYER_STEP +
    YOU_GAP +
    closed.length * TRACE_STEP +
    PAD_BOTTOM

  const traceY = (i: number) => H - PAD_BOTTOM - i * TRACE_STEP
  const waypoints = closed.map((ticket, i) => ({ ticket, x: CX, y: traceY(i) }))
  const you = { x: CX, y: traceY(closed.length) }

  // Lanes: the frontier forks evenly off HEAD; every merge sits at the mean of its open blockers.
  const placed: Placed[] = []
  const laneOf = new Map<number, number>()
  orderLayers(ahead).forEach((sorted, depth) => {
    const desired = sorted.map((ticket, i) => {
      if (depth === 0) return CX + (i - (sorted.length - 1) / 2) * Math.min(LANE_GAP * 1.35, 210)
      const upstream = ticket.blockedBy.filter((b) => b.isOpen && laneOf.has(b.number))
      if (upstream.length === 0) return CX
      return upstream.reduce((sum, b) => sum + (laneOf.get(b.number) ?? CX), 0) / upstream.length
    })
    const spaced = spaceLanes(desired)
    sorted.forEach((ticket, i) => {
      const x = spaced[i] ?? CX
      laneOf.set(ticket.number, x)
      placed.push({
        ticket,
        x,
        y: you.y - YOU_GAP - depth * LAYER_STEP,
        labelAbove: i % 2 === 1,
      })
    })
  })
  const placedByNumber = new Map(placed.map((p) => [p.ticket.number, p]))

  // Tips: charted branches nothing charted depends on — their rails fade toward the destination.
  const blockedElsewhere = new Set(
    placed.flatMap((p) => p.ticket.blockedBy.filter((b) => b.isOpen).map((b) => b.number)),
  )
  const tips = placed.filter((p) => !blockedElsewhere.has(p.ticket.number))

  const fogBottom = PAD_TOP + DEST_H + FOG_H
  const jitter = (seed: number): number => {
    const x = Math.sin(seed * 127.1) * 43758.5453
    return (x - Math.floor(x)) * 2 - 1
  }
  const fog = map.body.notYetSpecified.map((item, i) => ({
    item,
    cx: W * 0.16 + ((i * 0.618 + 0.35) % 1) * W * 0.68,
    cy: fogBottom - FOG_H * (0.12 + 0.5 * ((jitter(i + 40) + 1) / 2)),
    rx: 100 + 60 * ((jitter(i + 7) + 1) / 2),
    ry: 30 + 16 * ((jitter(i + 13) + 1) / 2),
  }))

  return (
    <div>
      <MapHead map={map} />
      <div className="d-wrap">
        <svg
          className="d-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`The history of ${map.title}, read bottom to top like a commit graph`}
        >
          <title>{map.title}</title>
          <defs>
            <filter id="g-blur" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
          </defs>

          {/* the fog — the region no branch has been charted into */}
          <g filter="url(#g-blur)">
            {fog.map((patch) => (
              <ellipse
                key={patch.item}
                cx={patch.cx}
                cy={patch.cy}
                rx={patch.rx}
                ry={patch.ry}
                fill="var(--proto-ink)"
                fillOpacity="0.13"
              >
                <title>{patch.item}</title>
              </ellipse>
            ))}
            {[0, 1, 2].map((i) => (
              <ellipse
                key={i}
                cx={W * (0.2 + 0.3 * i) + jitter(i + 21) * 60}
                cy={fogBottom - FOG_H * 0.55 + jitter(i + 33) * 30}
                rx={150}
                ry={26}
                fill="var(--proto-ink)"
                fillOpacity="0.07"
              />
            ))}
          </g>

          {/* the destination — the final merge, pinned past the fog */}
          <text x={CX} y={PAD_TOP + 24} textAnchor="middle" className="d-flag">
            ⚑
          </text>
          <foreignObject x={CX - 330} y={PAD_TOP + 34} width={660} height={DEST_H - 34}>
            <p className="d-dest" title={map.body.destination}>
              {map.body.destination}
            </p>
          </foreignObject>

          {/* branch tips trail off toward the destination, dissolving where the fog begins */}
          {tips.map(({ ticket, x, y }) => (
            <path
              key={`tip-${ticket.number}`}
              d={rail({ x, y }, { x: x + (CX - x) * 0.55, y: fogBottom + 6 })}
              fill="none"
              stroke="var(--proto-muted)"
              strokeWidth="1.5"
              strokeOpacity="0.22"
              strokeDasharray="3 6"
              strokeLinecap="round"
            />
          ))}

          {/* rails ahead: branches that do not exist yet, converging on their merges */}
          {placed.flatMap(({ ticket, x, y }) =>
            ticket.blockedBy
              .filter((b) => b.isOpen)
              .map((b) => {
                const from = placedByNumber.get(b.number)
                if (!from) return null
                return (
                  <path
                    key={`${ticket.number}-${b.number}`}
                    d={rail(from, { x, y })}
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

          {/* the fork at HEAD: one dashed lane out to every branch takeable or being walked */}
          {placed
            .filter(({ ticket }) => !ticket.isBlocked)
            .map(({ ticket, x, y }) => (
              <path
                key={`fork-${ticket.number}`}
                d={rail(you, { x, y })}
                fill="none"
                stroke={ticket.state === 'claimed' ? 'var(--state-claimed)' : 'var(--proto-muted)'}
                strokeWidth="1.75"
                strokeOpacity={ticket.state === 'claimed' ? 0.7 : 0.5}
                strokeDasharray={ticket.state === 'claimed' ? '7 5' : '3 5'}
                strokeLinecap="round"
              />
            ))}

          {/* the trunk — history already merged, thickening with every decision it carries */}
          {waypoints.map((wp, i) => (
            <line
              key={`trunk-${wp.ticket.number}`}
              x1={CX}
              y1={i === 0 ? wp.y + TRACE_STEP * 0.8 : traceY(i - 1)}
              x2={CX}
              y2={wp.y}
              stroke="var(--proto-ink)"
              strokeOpacity="0.55"
              strokeWidth={2 + i * 0.35}
              strokeLinecap="round"
            />
          ))}
          {waypoints.length > 0 && (
            <line
              x1={CX}
              y1={traceY(waypoints.length - 1)}
              x2={CX}
              y2={you.y}
              stroke="var(--proto-ink)"
              strokeOpacity="0.55"
              strokeWidth={2 + waypoints.length * 0.35}
              strokeLinecap="round"
            />
          )}
          {waypoints.map((wp, i) => (
            <a key={wp.ticket.number} href={wp.ticket.url}>
              <circle cx={wp.x} cy={wp.y} r="5.5" fill="var(--proto-ink)" fillOpacity="0.7">
                <title>
                  {wp.ticket.title}
                  {gistByTitle.has(wp.ticket.title) ? ` — ${gistByTitle.get(wp.ticket.title)}` : ''}
                </title>
              </circle>
              <text
                x={wp.x + (i % 2 === 0 ? 16 : -16)}
                y={wp.y + 4}
                textAnchor={i % 2 === 0 ? 'start' : 'end'}
                className="d-waypoint"
              >
                {truncate(wp.ticket.title, 36)}
              </text>
            </a>
          ))}

          {/* HEAD — you are here */}
          <text x={you.x} y={you.y + 5} textAnchor="middle" className="d-you">
            ▲
          </text>
          <text x={you.x + 13} y={you.y + 5} textAnchor="start" className="d-you-label">
            you are here
          </text>

          {placed.map((p) => (
            <Node key={p.ticket.number} placed={p} />
          ))}
        </svg>
      </div>
    </div>
  )
}

function Node({ placed }: { placed: Placed }) {
  const { ticket, x, y, labelAbove } = placed
  const meta = STATE_META[ticket.state]
  const login = ticket.assignees[0]?.login
  const titleY = labelAbove ? y - 32 : y + 24
  const wordY = labelAbove ? y - 19 : y + 38

  return (
    <a href={ticket.url}>
      <title>{ticket.title}</title>
      {ticket.state === 'frontier' && (
        <>
          <circle cx={x} cy={y} r="17" fill={meta.color} fillOpacity="0.16" />
          <rect
            x={x - 7.5}
            y={y - 7.5}
            width="15"
            height="15"
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
            r="9"
            fill="var(--proto-surface)"
            stroke={meta.color}
            strokeWidth="2.5"
          />
          <path d={`M ${x} ${y - 9} A 9 9 0 0 0 ${x} ${y + 9} Z`} fill={meta.color} />
        </>
      )}
      {ticket.state === 'blocked' && (
        <circle
          cx={x}
          cy={y}
          r="7.5"
          fill="var(--proto-plane)"
          stroke={meta.color}
          strokeWidth="2"
        />
      )}
      <text
        x={x}
        y={titleY}
        textAnchor="middle"
        className={`d-node-title ${ticket.state === 'blocked' ? 'is-dim' : ''}`}
      >
        {truncate(ticket.title, 32)}
      </text>
      <text x={x} y={wordY} textAnchor="middle" className="d-node-word" fill={meta.color}>
        {meta.glyph} {meta.word}
        {login !== undefined ? ` · ${login}` : ''}
      </text>
    </a>
  )
}
