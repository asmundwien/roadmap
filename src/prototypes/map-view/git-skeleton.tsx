/**
 * PROTOTYPE — throwaway. The fixed skeleton every git-history take shares: trunk of merged
 * decisions, HEAD marker, fog band, pinned destination, and the state markers. These are the
 * decisions the round has already settled — the variants disagree only about the braid ahead of
 * HEAD, so only that is variant code.
 */

import type { Ticket, WayfinderMap } from '../../wayfinder/types.ts'
import { MapHead, STATE_META } from './chrome.tsx'

export const W = 1000
export const CX = W / 2
export const PAD_TOP = 16
export const DEST_H = 104
export const FOG_H = 140
export const GAP_FOG = 56
export const LAYER_STEP = 112
export const YOU_GAP = 72
export const TRACE_STEP = 44
export const PAD_BOTTOM = 40

/** Deterministic noise in [-1, 1] — stable geography across renders, no Math.random. */
export function jitter(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

export interface Frame {
  height: number
  you: { x: number; y: number }
  waypoints: { ticket: Ticket; x: number; y: number }[]
  fogBottom: number
  /** Top edge of the braid region — the lowest y the fog owns plus the gap under it. */
  braidTop: number
}

/** The vertical frame: variants choose only how tall the braid ahead of HEAD is. */
export function computeFrame(closed: Ticket[], braidHeight: number): Frame {
  const height =
    PAD_TOP +
    DEST_H +
    FOG_H +
    GAP_FOG +
    braidHeight +
    YOU_GAP +
    closed.length * TRACE_STEP +
    PAD_BOTTOM
  const traceY = (i: number) => height - PAD_BOTTOM - i * TRACE_STEP
  return {
    height,
    you: { x: CX, y: traceY(closed.length) },
    waypoints: closed.map((ticket, i) => ({ ticket, x: CX, y: traceY(i) })),
    fogBottom: PAD_TOP + DEST_H + FOG_H,
    braidTop: PAD_TOP + DEST_H + FOG_H + GAP_FOG,
  }
}

/** Header plus the SVG shell — the page chrome no take is deciding anymore. */
export function GitCanvas({
  map,
  frame,
  ariaLabel,
  children,
}: {
  map: WayfinderMap
  frame: Frame
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <div>
      <MapHead map={map} />
      <div className="d-wrap">
        <svg
          className="d-svg"
          viewBox={`0 0 ${W} ${frame.height}`}
          role="img"
          aria-label={ariaLabel}
        >
          <title>{map.title}</title>
          {children}
        </svg>
      </div>
    </div>
  )
}

export function FogBand({
  map,
  fogBottom,
  id,
}: {
  map: WayfinderMap
  fogBottom: number
  id: string
}) {
  const fog = map.body.notYetSpecified.map((item, i) => ({
    item,
    cx: W * 0.16 + ((i * 0.618 + 0.35) % 1) * W * 0.68,
    cy: fogBottom - FOG_H * (0.12 + 0.5 * ((jitter(i + 40) + 1) / 2)),
    rx: 100 + 60 * ((jitter(i + 7) + 1) / 2),
    ry: 30 + 16 * ((jitter(i + 13) + 1) / 2),
  }))
  return (
    <>
      <defs>
        <filter id={id} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
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
    </>
  )
}

export function DestinationPin({ map }: { map: WayfinderMap }) {
  return (
    <>
      <text x={CX} y={PAD_TOP + 24} textAnchor="middle" className="d-flag">
        ⚑
      </text>
      <foreignObject x={CX - 330} y={PAD_TOP + 34} width={660} height={DEST_H - 34}>
        <p className="d-dest" title={map.body.destination}>
          {map.body.destination}
        </p>
      </foreignObject>
    </>
  )
}

export function Trunk({ frame, map }: { frame: Frame; map: WayfinderMap }) {
  const gistByTitle = new Map(map.body.decisions.map((d) => [d.title, d.gist]))
  const { waypoints, you } = frame
  return (
    <>
      {waypoints.map((wp, i) => (
        <line
          key={`trunk-${wp.ticket.number}`}
          x1={CX}
          y1={i === 0 ? wp.y + TRACE_STEP * 0.8 : (waypoints[i - 1]?.y ?? wp.y)}
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
          y1={waypoints[waypoints.length - 1]?.y ?? you.y}
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
      <text x={you.x} y={you.y + 5} textAnchor="middle" className="d-you">
        ▲
      </text>
      <text x={you.x + 13} y={you.y + 5} textAnchor="start" className="d-you-label">
        you are here
      </text>
    </>
  )
}

/** The state marker alone — labels are layout, so each variant places its own. */
export function StateMarker({ ticket, x, y }: { ticket: Ticket; x: number; y: number }) {
  const meta = STATE_META[ticket.state]
  return (
    <>
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
    </>
  )
}
