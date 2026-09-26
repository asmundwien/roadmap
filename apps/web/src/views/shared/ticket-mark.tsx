import type { TicketState, TicketType } from '@roadmap/contracts'
import { Mark, type MarkSize } from '@/components/mark/mark'
import { TICKET_STATE_META, TICKET_TYPE_META } from './ticket-presentation'

const CLOSED_GLYPH = '✓'

export type TicketMarkProps = {
  size: MarkSize
  state: TicketState
  type: TicketType
}

/** The application's ticket encoding, rendered as one mark. Callers pass product facts only. */
export function TicketMark({ size, state, type }: TicketMarkProps) {
  const stateMeta = TICKET_STATE_META[state]
  const typeMeta = TICKET_TYPE_META[type]
  return (
    <Mark
      accent={typeMeta.accent}
      corners={typeMeta.corners}
      fill={stateMeta.fill}
      glyph={state === 'closed' ? CLOSED_GLYPH : typeMeta.glyph}
      size={size}
      variant={stateMeta.variant}
    />
  )
}
