import type { TicketState } from '@roadmap/contracts'
import type { BadgeVariant } from '../../components/badge/badge.tsx'

type StateMeta = {
  word: string
  color: string
  badgeVariant: BadgeVariant
}

/** Text and presentation paired with ticket state. */
export const STATE_META = {
  closed: { word: 'decided', color: 'var(--state-closed)', badgeVariant: 'muted' },
  frontier: { word: 'takeable', color: 'var(--state-frontier)', badgeVariant: 'success' },
  claimed: { word: 'claimed', color: 'var(--state-claimed)', badgeVariant: 'info' },
  blocked: { word: 'blocked', color: 'var(--state-blocked)', badgeVariant: 'danger' },
} as const satisfies Record<TicketState, StateMeta>
