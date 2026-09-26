import type { TicketState, TicketType } from '@roadmap/contracts'
import './ticket-mark.css'

export type TicketMarkSize = 'large' | 'medium' | 'small'

export type TicketMarkProps = {
  size: TicketMarkSize
  state: TicketState
  type: TicketType
}

const SIZE_ATTRIBUTES = {
  large: { height: 32, width: 32, x: -16, y: -16 },
  medium: { height: 12, width: 12, x: -6, y: -6 },
  small: { height: '0.625em', width: '0.625em', x: '-0.3125em', y: '-0.3125em' },
} as const satisfies Record<
  TicketMarkSize,
  { height: number | string; width: number | string; x: number | string; y: number | string }
>

const TYPE_GLYPH = {
  research: 'R',
  prototype: 'P',
  grilling: 'G',
  task: 'T',
  untyped: '·',
} as const satisfies Record<TicketType, string>

const TYPE_CORNER_COUNT = {
  research: 1,
  prototype: 2,
  grilling: 3,
  task: 4,
  untyped: 0,
} as const satisfies Record<TicketType, 0 | 1 | 2 | 3 | 4>

const FACE_PATH = 'M 0 -14.667 L 14.667 0 L 0 14.667 L -14.667 0 Z'
const HALF_PATH = 'M 0 -14.667 L 0 14.667 L -14.667 0 Z'

/** The ticket state and type mark in each supported application size. */
export function TicketMark({ size, state, type }: TicketMarkProps) {
  const sizeAttributes = SIZE_ATTRIBUTES[size]
  return (
    <svg
      className={`ticket-mark ticket-mark-${size} state-${state} type-${type}`}
      viewBox="-16 -16 32 32"
      aria-hidden="true"
      focusable="false"
      {...sizeAttributes}
    >
      <path className="ticket-mark-face" d={FACE_PATH} />
      {state === 'claimed' && <path className="ticket-mark-half" d={HALF_PATH} />}
      <text className="ticket-mark-content" x="0" y="4.4" textAnchor="middle">
        {state === 'closed' ? '✓' : TYPE_GLYPH[type]}
      </text>
      <TicketMarkCorners count={TYPE_CORNER_COUNT[type]} />
    </svg>
  )
}

type TicketMarkCornersProps = { count: 0 | 1 | 2 | 3 | 4 }

function TicketMarkCorners({ count }: TicketMarkCornersProps) {
  if (count === 0) return null
  return (
    <g className="ticket-mark-corners">
      <path className="ticket-mark-corner" d="M -9.333 -5.333 L 0 -14.667" />
      {count >= 2 && <path className="ticket-mark-corner" d="M 5.333 -9.333 L 14.667 0" />}
      {count >= 3 && <path className="ticket-mark-corner" d="M 9.333 5.333 L 0 14.667" />}
      {count === 4 && <path className="ticket-mark-corner" d="M -5.333 9.333 L -14.667 0" />}
    </g>
  )
}
