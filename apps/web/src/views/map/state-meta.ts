import type { TicketState } from '@roadmap/contracts'
import type { TicketMarkFill } from '../../components/ticket-mark/ticket-mark.tsx'
import { VARIANT_COLORS, type Variant } from '../../components/variant.ts'

type StateMeta = {
  word: string
  color: string
  fill: TicketMarkFill
  variant: Variant
}

/** Text and presentation paired with ticket state. */
export const STATE_META = {
  closed: { word: 'decided', color: VARIANT_COLORS.muted, fill: 'fill', variant: 'muted' },
  frontier: { word: 'takeable', color: VARIANT_COLORS.success, fill: 'fill', variant: 'success' },
  claimed: { word: 'claimed', color: VARIANT_COLORS.info, fill: 'half', variant: 'info' },
  blocked: { word: 'blocked', color: VARIANT_COLORS.danger, fill: 'none', variant: 'danger' },
} as const satisfies Record<TicketState, StateMeta>
