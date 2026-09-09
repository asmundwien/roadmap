import type { TicketState } from '@roadmap/contracts'

/** Text and colour paired with the ticket mark; the mark itself lives in the shared atom. */
export const STATE_META: Record<TicketState, { word: string; color: string }> = {
  closed: { word: 'decided', color: 'var(--state-closed)' },
  frontier: { word: 'takeable', color: 'var(--state-frontier)' },
  claimed: { word: 'claimed', color: 'var(--state-claimed)' },
  blocked: { word: 'blocked', color: 'var(--state-blocked)' },
}
