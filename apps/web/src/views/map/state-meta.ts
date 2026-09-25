import type { TicketState } from '@roadmap/contracts'
import { badgeForTicketState, badgeLabel } from '../../components/badge/badge.tsx'

/** Text and colour paired with the shared ticket mark component. */
export const STATE_META: Record<TicketState, { word: string; color: string }> = {
  closed: { word: labelFor('closed'), color: 'var(--state-closed)' },
  frontier: { word: labelFor('frontier'), color: 'var(--state-frontier)' },
  claimed: { word: labelFor('claimed'), color: 'var(--state-claimed)' },
  blocked: { word: labelFor('blocked'), color: 'var(--state-blocked)' },
}

function labelFor(state: TicketState): string {
  return badgeLabel(badgeForTicketState(state)).toLowerCase()
}
