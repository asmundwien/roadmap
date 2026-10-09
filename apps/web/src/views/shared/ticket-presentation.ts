import type { TicketState, TicketType } from '@roadmap/contracts/state'
import type { MarkCornerCount, MarkFill } from '@roadmap/ui/mark'
import type { Variant } from '@roadmap/ui/variant'

type TicketStateMeta = { word: string; variant: Variant; fill: MarkFill }
type TicketTypeMeta = { glyph: string; accent: Variant; corners: MarkCornerCount }

/** Ticket state decides the word, the color, and how much of the mark is filled. */
export const TICKET_STATE_META = {
  closed: { word: 'decided', variant: 'muted', fill: 'solid' },
  frontier: { word: 'takeable', variant: 'success', fill: 'solid' },
  claimed: { word: 'claimed', variant: 'info', fill: 'half' },
  blocked: { word: 'blocked', variant: 'danger', fill: 'outline' },
} as const satisfies Record<TicketState, TicketStateMeta>

/** Ticket type decides the glyph, the corner strokes, and their accent color. */
export const TICKET_TYPE_META = {
  untyped: { glyph: '·', accent: 'neutral', corners: 0 },
  research: { glyph: 'R', accent: 'success', corners: 1 },
  prototype: { glyph: 'P', accent: 'warning', corners: 2 },
  grilling: { glyph: 'G', accent: 'danger', corners: 3 },
  task: { glyph: 'T', accent: 'accent', corners: 4 },
} as const satisfies Record<TicketType, TicketTypeMeta>
