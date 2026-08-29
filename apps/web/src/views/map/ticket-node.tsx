import type { Ticket, TicketType } from '@roadmap/contracts'
import type { AutomationTag } from './automation-presentation.ts'
import { STATE_META } from './state-meta.ts'

const NODE_SCALE = 4 / 3
const PRIMARY_RADIUS = 11 * NODE_SCALE
const FRONTIER_RADIUS = 17 * NODE_SCALE
const MINOR_RADIUS = 6.5 * NODE_SCALE
const FIRST_TAG_OFFSET = 19 * NODE_SCALE
const TAG_PITCH = 14 * NODE_SCALE

export function TicketNode({
  ticket,
  type,
  tags,
  x,
  y,
}: {
  ticket: Ticket
  type: TicketType
  tags: readonly AutomationTag[]
  x: number
  y: number
}) {
  return (
    <g className={`ticket-node type-${type} state-${ticket.state}`}>
      <MainDiamond ticket={ticket} type={type} x={x} y={y} />
      {tags.map((tag, index) => (
        <DataDiamond key={tag.slot} tag={tag} x={x + FIRST_TAG_OFFSET + index * TAG_PITCH} y={y} />
      ))}
    </g>
  )
}

/** Keeps the title clear of the widest evidence ribbon while preserving normal row alignment. */
export function ticketNodeTextX(x: number, baseline: number, tagCount: number): number {
  if (tagCount === 0) return baseline
  const lastTagRight = x + FIRST_TAG_OFFSET + (tagCount - 1) * TAG_PITCH + MINOR_RADIUS
  return Math.max(baseline, lastTagRight + 8)
}

function MainDiamond({
  ticket,
  type,
  x,
  y,
}: {
  ticket: Ticket
  type: TicketType
  x: number
  y: number
}) {
  return (
    <g className="main-diamond">
      <g className="node-shape">
        {ticket.state === 'frontier' && (
          <path className="frontier-field" d={diamondPath(x, y, FRONTIER_RADIUS)} />
        )}
        <path className="diamond-face" d={diamondPath(x, y, PRIMARY_RADIUS)} />
        {ticket.state === 'claimed' && (
          <path
            className="claimed-half"
            d={`M ${x} ${y - PRIMARY_RADIUS} L ${x} ${y + PRIMARY_RADIUS} L ${x - PRIMARY_RADIUS} ${y} Z`}
          />
        )}
        {ticket.state !== 'closed' && ticket.isBlocked && ticket.state !== 'blocked' && (
          <path
            className="blocked-corner"
            d={`M ${x - PRIMARY_RADIUS} ${y} L ${x} ${y + PRIMARY_RADIUS} L ${x - 4 * NODE_SCALE} ${y + 7 * NODE_SCALE} Z`}
          />
        )}
        {ticket.state !== 'closed' && ticket.isClaimed && ticket.state !== 'claimed' && (
          <path
            className="claimed-corner"
            d={`M ${x} ${y - PRIMARY_RADIUS} L ${x + PRIMARY_RADIUS} ${y} L ${x + 5 * NODE_SCALE} ${y - 6 * NODE_SCALE} Z`}
          />
        )}
        <text className="type-rune" x={x} y={y + 3.3 * NODE_SCALE} textAnchor="middle">
          {ticket.state === 'closed' ? '✓' : typeGlyph(type)}
        </text>
        <TypeCorners type={type} x={x} y={y} />
      </g>
      <NodeTooltip x={x} y={y - 20 * NODE_SCALE} word={STATE_META[ticket.state].word} />
    </g>
  )
}

function TypeCorners({ type, x, y }: { type: TicketType; x: number; y: number }) {
  const count = typeRank(type)
  if (count === 0) return null
  const corners = [
    `M ${x - 7 * NODE_SCALE} ${y - 4 * NODE_SCALE} L ${x} ${y - PRIMARY_RADIUS}`,
    `M ${x + 4 * NODE_SCALE} ${y - 7 * NODE_SCALE} L ${x + PRIMARY_RADIUS} ${y}`,
    `M ${x + 7 * NODE_SCALE} ${y + 4 * NODE_SCALE} L ${x} ${y + PRIMARY_RADIUS}`,
    `M ${x - 4 * NODE_SCALE} ${y + 7 * NODE_SCALE} L ${x - PRIMARY_RADIUS} ${y}`,
  ]
  return (
    <g className="type-corners">
      {corners.slice(0, count).map((path) => (
        <path key={path} d={path} />
      ))}
    </g>
  )
}

function DataDiamond({ tag, x, y }: { tag: AutomationTag; x: number; y: number }) {
  return (
    <g className={`data-diamond slot-${tag.slot} stage-${tag.stage}`}>
      <g className="tag-shape">
        <path className="tag-face" d={diamondPath(x, y, MINOR_RADIUS)} />
        <text className="tag-glyph" x={x} y={y + 2.5 * NODE_SCALE} textAnchor="middle">
          {tag.glyph}
        </text>
      </g>
      <NodeTooltip x={x} y={y - 13 * NODE_SCALE} word={tag.word} />
    </g>
  )
}

function NodeTooltip({ x, y, word }: { x: number; y: number; word: string }) {
  const width = Math.max(32, word.length * 5.2 + 10)
  return (
    <g className="node-tooltip" transform={`translate(${x - width / 2} ${y})`}>
      <rect width={width} height="13" />
      <text x={width / 2} y="9" textAnchor="middle">
        {word}
      </text>
    </g>
  )
}

function diamondPath(x: number, y: number, radius: number): string {
  return `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`
}

function typeGlyph(type: TicketType): string {
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
