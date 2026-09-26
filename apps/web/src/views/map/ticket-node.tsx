import type { Ticket, TicketType } from '@roadmap/contracts'
import { Mark, MEDIUM_MARK_EXTENT } from '@/components/mark/mark'
import { TicketMark } from '@/views/shared/ticket-mark'
import { TICKET_STATE_META } from '@/views/shared/ticket-presentation'
import { AUTOMATION_VARIANT, type AutomationTag } from './automation-presentation'

const FIRST_TAG_OFFSET = 22
const TAG_PITCH = 14
const TICKET_TOOLTIP_OFFSET = 80 / 3

type TicketNodeProps = {
  ticket: Ticket
  type: TicketType
  tags: readonly AutomationTag[]
  x: number
  y: number
}

export function TicketNode({ ticket, type, tags, x, y }: TicketNodeProps) {
  return (
    <g className="ticket-node">
      <MajorTicketNode ticket={ticket} type={type} x={x} y={y} />
      {tags.map((tag, index) => (
        <AutomationNode
          key={tag.slot}
          tag={tag}
          x={x + FIRST_TAG_OFFSET + index * TAG_PITCH}
          y={y}
        />
      ))}
    </g>
  )
}

/** Keeps the title clear of the widest evidence ribbon while preserving normal row alignment. */
export function ticketNodeTextX(x: number, baseline: number, tagCount: number): number {
  if (tagCount === 0) return baseline
  const lastTagRight = x + FIRST_TAG_OFFSET + (tagCount - 1) * TAG_PITCH + MEDIUM_MARK_EXTENT
  return Math.max(baseline, lastTagRight + 8)
}

type MajorTicketNodeProps = {
  ticket: Ticket
  type: TicketType
  x: number
  y: number
}

function MajorTicketNode({ ticket, type, x, y }: MajorTicketNodeProps) {
  return (
    <g className="major-node">
      <g transform={`translate(${x} ${y})`}>
        <TicketMark state={ticket.state} type={type} size="large" />
      </g>
      <NodeTooltip
        x={x}
        y={y - TICKET_TOOLTIP_OFFSET}
        word={TICKET_STATE_META[ticket.state].word}
      />
    </g>
  )
}

type AutomationNodeProps = { tag: AutomationTag; x: number; y: number }

function AutomationNode({ tag, x, y }: AutomationNodeProps) {
  return (
    <g className={`automation-node slot-${tag.slot}`}>
      <g transform={`translate(${x} ${y})`}>
        <Mark
          fill="solid"
          glyph={tag.glyph}
          size="medium"
          variant={AUTOMATION_VARIANT[tag.stage]}
        />
      </g>
      <NodeTooltip x={x} y={y - 52 / 3} word={tag.word} />
    </g>
  )
}

type NodeTooltipProps = { x: number; y: number; word: string }

function NodeTooltip({ x, y, word }: NodeTooltipProps) {
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
