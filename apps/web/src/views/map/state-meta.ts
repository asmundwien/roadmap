import type { TicketState } from '@roadmap/contracts'
import { statusTagForTicketState, statusTagLabel } from '../../components/status-tag/status-tag.tsx'

/** Text and colour paired with the shared ticket mark component. */
export const STATE_META: Record<TicketState, { word: string; color: string }> = {
  closed: { word: labelFor('closed'), color: 'var(--state-closed)' },
  frontier: { word: labelFor('frontier'), color: 'var(--state-frontier)' },
  claimed: { word: labelFor('claimed'), color: 'var(--state-claimed)' },
  blocked: { word: labelFor('blocked'), color: 'var(--state-blocked)' },
}

function labelFor(state: TicketState): string {
  return statusTagLabel(statusTagForTicketState(state)).toLowerCase()
}
