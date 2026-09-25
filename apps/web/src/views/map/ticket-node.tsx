import type { Ticket, TicketType } from '@roadmap/contracts'
import {
  AUTOMATION_MARK_RADIUS,
  AutomationMark,
} from '../../components/automation-mark/automation-mark.tsx'
import { MAJOR_TICKET_MARK_SCALE, TicketMark } from '../../components/ticket-mark/ticket-mark.tsx'
import type { AutomationTag } from './automation-presentation.ts'
import { STATE_META } from './state-meta.ts'

const NODE_SCALE = MAJOR_TICKET_MARK_SCALE
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
    <g className="ticket-node">
      <MajorTicketNode ticket={ticket} type={type} x={x} y={y} />
      {tags.map((tag, index) => (
        <DataDiamond key={tag.slot} tag={tag} x={x + FIRST_TAG_OFFSET + index * TAG_PITCH} y={y} />
      ))}
    </g>
  )
}

/** Keeps the title clear of the widest evidence ribbon while preserving normal row alignment. */
export function ticketNodeTextX(x: number, baseline: number, tagCount: number): number {
  if (tagCount === 0) return baseline
  const lastTagRight = x + FIRST_TAG_OFFSET + (tagCount - 1) * TAG_PITCH + AUTOMATION_MARK_RADIUS
  return Math.max(baseline, lastTagRight + 8)
}

function MajorTicketNode({
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
    <g className="major-node">
      <TicketMark ticket={ticket} type={type} variant="major" x={x} y={y} />
      <NodeTooltip x={x} y={y - 20 * NODE_SCALE} word={STATE_META[ticket.state].word} />
    </g>
  )
}

function DataDiamond({ tag, x, y }: { tag: AutomationTag; x: number; y: number }) {
  return (
    <g className={`data-diamond slot-${tag.slot}`}>
      <AutomationMark variant="plot" stage={tag.stage} glyph={tag.glyph} x={x} y={y} />
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
