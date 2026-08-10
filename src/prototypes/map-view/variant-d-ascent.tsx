/**
 * PROTOTYPE — throwaway. Variant D: the ascent.
 *
 * The composite the research shortlist recommends: a campaign-route map read upward toward a
 * pinned destination, tech-tree node states carrying frontier/blocked, and the region beyond the
 * charted tickets rendered as fog rather than confident empty canvas.
 *
 * One axis means forward: up. Behind the traveller the route already walked accumulates as a
 * solid trace that thickens with what it carried (Minard) — its waypoints are the decisions, gists
 * on hover, never a list. Ahead, the charted-but-open tickets braid upward: dotted paths not yet
 * walked, blocked nodes held behind visible prerequisite edges. Past the last charted ticket the
 * canvas stops pretending to know: fog, dim and unlabelled, with the destination pinned above it.
 */

import type { Ticket } from '../../wayfinder/types.ts'
import { MapHead, STATE_META } from './chrome.tsx'
import { layerMap, orderLayers } from './layout.ts'
import type { VariantProps } from './variants.ts'

export const NAME = 'The ascent'

const W = 1000
const CX = W / 2
const PAD_TOP = 16
const DEST_H = 104
const FOG_H = 140
const GAP_FOG = 48
const LAYER_STEP = 104
const YOU_GAP = 64
const TRACE_STEP = 46
const PAD_BOTTOM = 40
const MEANDER = 110

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
  labelAbove: boolean
}

export function VariantD({ map }: VariantProps) {
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

  const traceX = (i: number) => CX + Math.sin(i * 0.85) * MEANDER
  const traceY = (i: number) => H - PAD_BOTTOM - i * TRACE_STEP
  const waypoints = closed.map((ticket, i) => ({ ticket, x: traceX(i), y: traceY(i) }))
  const you = { x: traceX(closed.length), y: traceY(closed.length) }

  const placed: Placed[] = orderLayers(ahead).flatMap((sorted, depth) => {
    return sorted.map((ticket, i) => ({
      ticket,
      x: 150 + ((i + 0.5) / sorted.length) * (W - 300) + jitter(ticket.number) * 24,
      y: you.y - YOU_GAP - depth * LAYER_STEP + jitter(ticket.number * 3) * 14,
      labelAbove: i % 2 === 1,
    }))
  })
  const placedByNumber = new Map(placed.map((p) => [p.ticket.number, p]))

  const fogBottom = PAD_TOP + DEST_H + FOG_H
  const fog = map.body.notYetSpecified.map((item, i) => ({
    item,
    cx: W * 0.16 + ((i * 0.618 + 0.35) % 1) * W * 0.68,
    cy: fogBottom - FOG_H * (0.12 + 0.5 * ((jitter(i + 40) + 1) / 2)),
    rx: 100 + 60 * ((jitter(i + 7) + 1) / 2),
    ry: 30 + 16 * ((jitter(i + 13) + 1) / 2),
  }))

  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const my = (a.y + b.y) / 2
    return `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`
  }

  return (
    <div>
      <MapHead map={map} />
      <div className="d-wrap">
        <svg
          className="d-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`The route of ${map.title}, read bottom to top`}
        >
          <title>{map.title}</title>
          <defs>
            <filter id="d-blur" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
          </defs>

          {/* the fog — drawn ignorance, dim and unlabelled; the items live on hover only */}
          <g filter="url(#d-blur)">
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

          {/* the destination — pinned at the top of the travel axis, beyond the fog */}
          <text x={CX} y={PAD_TOP + 24} textAnchor="middle" className="d-flag">
            ⚑
          </text>
          <foreignObject x={CX - 330} y={PAD_TOP + 34} width={660} height={DEST_H - 34}>
            <p className="d-dest" title={map.body.destination}>
              {map.body.destination}
            </p>
          </foreignObject>

          {/* prerequisite edges — only along the travel axis, only where the blocker is still open */}
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
                    strokeOpacity="0.45"
                  />
                )
              }),
          )}

          {/* paths not yet walked: dotted stubs from here to everything takeable or in progress */}
          {placed
            .filter(({ ticket }) => !ticket.isBlocked && ticket.state !== 'closed')
            .map(({ ticket, x, y }) => (
              <path
                key={`stub-${ticket.number}`}
                d={curve(you, { x, y })}
                fill="none"
                stroke={ticket.state === 'claimed' ? 'var(--state-claimed)' : 'var(--proto-muted)'}
                strokeWidth="1.75"
                strokeOpacity={ticket.state === 'claimed' ? 0.65 : 0.55}
                strokeDasharray={ticket.state === 'claimed' ? '7 5' : '2 6'}
                strokeLinecap="round"
              />
            ))}

          {/* the trace — ground covered, thickening with what it has carried */}
          {waypoints.map((wp, i) => {
            const prev = i === 0 ? { x: wp.x, y: wp.y + TRACE_STEP * 0.8 } : waypoints[i - 1]
            if (!prev) return null
            return (
              <path
                key={`trace-${wp.ticket.number}`}
                d={curve(prev, wp)}
                fill="none"
                stroke="var(--proto-ink)"
                strokeOpacity="0.55"
                strokeWidth={2 + i * 0.35}
                strokeLinecap="round"
              />
            )
          })}
          {waypoints.length > 0 &&
            (() => {
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
                x={wp.x + (Math.sin(i * 0.85) >= 0 ? 14 : -14)}
                y={wp.y + 4}
                textAnchor={Math.sin(i * 0.85) >= 0 ? 'start' : 'end'}
                className="d-waypoint"
              >
                {truncate(wp.ticket.title, 34)}
              </text>
            </a>
          ))}

          {/* you are here — the traveller, at the end of the trace */}
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
