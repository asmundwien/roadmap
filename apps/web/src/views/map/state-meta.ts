import type { TicketState } from '@roadmap/contracts'
import { VARIANT_COLORS, type Variant } from '@/components/variant'

type StateMeta = {
  word: string
  color: string
  variant: Variant
}

/** Text presentation paired with ticket state. */
export const STATE_META = {
  closed: { word: 'decided', color: VARIANT_COLORS.muted, variant: 'muted' },
  frontier: { word: 'takeable', color: VARIANT_COLORS.success, variant: 'success' },
  claimed: { word: 'claimed', color: VARIANT_COLORS.info, variant: 'info' },
  blocked: { word: 'blocked', color: VARIANT_COLORS.danger, variant: 'danger' },
} as const satisfies Record<TicketState, StateMeta>
