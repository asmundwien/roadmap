import cn from 'classnames'
import { Diamond } from '../diamond/diamond.tsx'
import { VARIANT_COLORS, type Variant } from '../variant.ts'
import './ticket-mark.css'

export const MAJOR_TICKET_MARK_SCALE = 4 / 3
const MINOR_TICKET_MARK_SCALE = 0.42
const TINY_TICKET_MARK_SCALE = 0.42

export type TicketMarkFill = 'fill' | 'half' | 'none'
export type TicketMarkCornerCount = 0 | 1 | 2 | 3 | 4

type TicketMarkPresentationProps = {
  accent: Variant
  children: string
  cornerCount: TicketMarkCornerCount
  fill: TicketMarkFill
  variant: Variant
}

export type TicketMarkProps = TicketMarkPresentationProps &
  (
    | {
        size: 'major' | 'minor'
        x: number
        y: number
      }
    | {
        size: 'tiny'
      }
  )

/** A domain-independent diamond mark with separate color, accent, fill, and size controls. */
export function TicketMark(props: TicketMarkProps) {
  switch (props.size) {
    case 'major':
      return <MajorTicketMark {...props} />
    case 'minor':
      return <MinorTicketMark {...props} />
    case 'tiny':
      return <TinyTicketMark {...props} />
    default: {
      const _exhaustive: never = props
      return _exhaustive
    }
  }
}

type PositionedTicketMarkProps = TicketMarkPresentationProps & {
  x: number
  y: number
}

function MajorTicketMark(props: PositionedTicketMarkProps) {
  return <MarkShape {...props} scale={MAJOR_TICKET_MARK_SCALE} size="major" showContent />
}

function MinorTicketMark(props: PositionedTicketMarkProps) {
  return <MarkShape {...props} scale={MINOR_TICKET_MARK_SCALE} size="minor" />
}

function TinyTicketMark(props: TicketMarkPresentationProps) {
  return (
    <svg className="ticket-mark-tiny" viewBox="-8 -8 16 16" aria-hidden="true" focusable="false">
      <MarkShape {...props} scale={TINY_TICKET_MARK_SCALE} size="tiny" x={0} y={0} />
    </svg>
  )
}

type MarkShapeProps = PositionedTicketMarkProps & {
  scale: number
  size: 'major' | 'minor' | 'tiny'
  showContent?: boolean
}

function MarkShape({
  accent,
  children,
  cornerCount,
  fill,
  scale,
  showContent = false,
  size,
  variant,
  x,
  y,
}: MarkShapeProps) {
  const radius = 11 * scale
  return (
    <g className={cn('ticket-mark', `fill-${fill}`)} color={VARIANT_COLORS[variant]}>
      <g className={cn('node-shape', 'node-mark', `is-${size}`)}>
        <Diamond className="diamond-face" x={x} y={y} radius={radius} />
        {fill === 'half' && (
          <path
            className="mark-half"
            d={`M ${x} ${y - radius} L ${x} ${y + radius} L ${x - radius} ${y} Z`}
          />
        )}
        {showContent && children[0] !== undefined && (
          <text
            className="mark-content"
            color={VARIANT_COLORS[variant]}
            x={x}
            y={y + 3.3 * scale}
            textAnchor="middle"
          >
            {children[0]}
          </text>
        )}
        <g className="mark-accent" color={VARIANT_COLORS[accent]}>
          <MarkCorners cornerCount={cornerCount} scale={scale} x={x} y={y} />
        </g>
      </g>
    </g>
  )
}

type MarkCornersProps = {
  cornerCount: TicketMarkCornerCount
  scale: number
  x: number
  y: number
}

function MarkCorners({ cornerCount, scale, x, y }: MarkCornersProps) {
  if (cornerCount === 0) return null
  const radius = 11 * scale
  return (
    <g className="mark-corners">
      <path
        className="mark-corner"
        d={`M ${x - 7 * scale} ${y - 4 * scale} L ${x} ${y - radius}`}
      />
      {cornerCount >= 2 && (
        <path
          className="mark-corner"
          d={`M ${x + 4 * scale} ${y - 7 * scale} L ${x + radius} ${y}`}
        />
      )}
      {cornerCount >= 3 && (
        <path
          className="mark-corner"
          d={`M ${x + 7 * scale} ${y + 4 * scale} L ${x} ${y + radius}`}
        />
      )}
      {cornerCount === 4 && (
        <path
          className="mark-corner"
          d={`M ${x - 4 * scale} ${y + 7 * scale} L ${x - radius} ${y}`}
        />
      )}
    </g>
  )
}
