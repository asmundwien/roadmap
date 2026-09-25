import type { Ticket, TicketType } from '@roadmap/contracts'
import { Diamond } from '../diamond/diamond.tsx'
import './ticket-mark.css'

export const MAJOR_TICKET_MARK_SCALE = 4 / 3
const MINOR_TICKET_MARK_SCALE = 0.42

type TicketMarkState = Pick<Ticket, 'state' | 'isBlocked' | 'isClaimed'>

type TicketMarkProps =
  | {
      ticket: TicketMarkState
      type: TicketType
      variant: 'major' | 'minor'
      x: number
      y: number
    }
  | {
      ticket: TicketMarkState
      type: TicketType
      variant: 'inline'
    }

/** The project page's one ticket-state mark, shared by ledger nodes and inline status text. */
export function TicketMark(props: TicketMarkProps) {
  if (props.variant === 'inline') {
    return (
      <svg
        className="ticket-mark-inline"
        viewBox="-8 -8 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <TicketMark ticket={props.ticket} type={props.type} variant="minor" x={0} y={0} />
      </svg>
    )
  }

  const { ticket, type, variant, x, y } = props
  const scale = variant === 'major' ? MAJOR_TICKET_MARK_SCALE : MINOR_TICKET_MARK_SCALE
  const radius = 11 * scale
  const frontierRadius = 17 * scale
  return (
    <g className={`ticket-mark type-${type} state-${ticket.state}`}>
      <g className={`node-shape node-mark is-${variant}`}>
        {ticket.state === 'frontier' && (
          <Diamond className="frontier-field" x={x} y={y} radius={frontierRadius} />
        )}
        <Diamond className="diamond-face" x={x} y={y} radius={radius} />
        {ticket.state === 'claimed' && (
          <path
            className="claimed-half"
            d={`M ${x} ${y - radius} L ${x} ${y + radius} L ${x - radius} ${y} Z`}
          />
        )}
        {ticket.state !== 'closed' && ticket.isBlocked && ticket.state !== 'blocked' && (
          <path
            className="blocked-corner"
            d={`M ${x - radius} ${y} L ${x} ${y + radius} L ${x - 4 * scale} ${y + 7 * scale} Z`}
          />
        )}
        {ticket.state !== 'closed' && ticket.isClaimed && ticket.state !== 'claimed' && (
          <path
            className="claimed-corner"
            d={`M ${x} ${y - radius} L ${x + radius} ${y} L ${x + 5 * scale} ${y - 6 * scale} Z`}
          />
        )}
        {variant === 'major' && (
          <text className="type-rune" x={x} y={y + 3.3 * scale} textAnchor="middle">
            {ticket.state === 'closed' ? '✓' : typeRune(type)}
          </text>
        )}
        <TypeCorners type={type} scale={scale} x={x} y={y} />
      </g>
    </g>
  )
}

function TypeCorners({
  type,
  scale,
  x,
  y,
}: {
  type: TicketType
  scale: number
  x: number
  y: number
}) {
  const count = typeRank(type)
  if (count === 0) return null
  const radius = 11 * scale
  const corners = [
    `M ${x - 7 * scale} ${y - 4 * scale} L ${x} ${y - radius}`,
    `M ${x + 4 * scale} ${y - 7 * scale} L ${x + radius} ${y}`,
    `M ${x + 7 * scale} ${y + 4 * scale} L ${x} ${y + radius}`,
    `M ${x - 4 * scale} ${y + 7 * scale} L ${x - radius} ${y}`,
  ]
  return (
    <g className="type-corners">
      {corners.slice(0, count).map((path) => (
        <path key={path} d={path} />
      ))}
    </g>
  )
}

function typeRune(type: TicketType): string {
  switch (type) {
    case 'research':
      return 'R'
    case 'prototype':
      return 'P'
    case 'grilling':
      return 'G'
    case 'task':
      return 'T'
    case 'untyped':
      return '·'
    default: {
      const _exhaustive: never = type
      return _exhaustive
    }
  }
}

function typeRank(type: TicketType): number {
  switch (type) {
    case 'research':
      return 1
    case 'prototype':
      return 2
    case 'grilling':
      return 3
    case 'task':
      return 4
    case 'untyped':
      return 0
    default: {
      const _exhaustive: never = type
      return _exhaustive
    }
  }
}
