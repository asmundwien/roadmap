import type { TicketState, TicketType } from '@roadmap/contracts'
import { TicketMark, type TicketMarkCornerCount } from '@/components/ticket-mark/ticket-mark'
import type { Variant } from '@/components/variant'
import { STATE_META } from './state-meta'

type TicketTypeMark = {
  accent: Variant
  children: string
  cornerCount: TicketMarkCornerCount
}

const TICKET_TYPE_MARK = {
  research: { accent: 'success', children: 'R', cornerCount: 1 },
  prototype: { accent: 'warning', children: 'P', cornerCount: 2 },
  grilling: { accent: 'danger', children: 'G', cornerCount: 3 },
  task: { accent: 'accent', children: 'T', cornerCount: 4 },
  untyped: { accent: 'neutral', children: '·', cornerCount: 0 },
} as const satisfies Record<TicketType, TicketTypeMark>

type RoadmapTicketMarkProps = {
  state: TicketState
  type: TicketType
} & (
  | {
      size: 'major' | 'minor'
      x: number
      y: number
    }
  | {
      size: 'tiny'
    }
)

export function RoadmapTicketMark(props: RoadmapTicketMarkProps) {
  const state = STATE_META[props.state]
  const type = TICKET_TYPE_MARK[props.type]
  const children = props.state === 'closed' ? '✓' : type.children
  if (props.size === 'tiny') {
    return TicketMark({
      accent: type.accent,
      children,
      cornerCount: type.cornerCount,
      fill: state.fill,
      size: 'tiny',
      variant: state.variant,
    })
  }

  return TicketMark({
    accent: type.accent,
    children,
    cornerCount: type.cornerCount,
    fill: state.fill,
    size: props.size,
    variant: state.variant,
    x: props.x,
    y: props.y,
  })
}
