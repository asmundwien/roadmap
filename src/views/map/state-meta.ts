import type { TicketState } from '../../wayfinder/types.ts'

/**
 * A glyph and a word per state, so colour is never the only channel — the dataviz rule for status
 * palettes, and the relief the light-mode blocked magenta needs to earn its place.
 */
export const STATE_META: Record<TicketState, { glyph: string; word: string; color: string }> = {
  closed: { glyph: '●', word: 'decided', color: 'var(--state-closed)' },
  frontier: { glyph: '◆', word: 'takeable', color: 'var(--state-frontier)' },
  claimed: { glyph: '◐', word: 'claimed', color: 'var(--state-claimed)' },
  blocked: { glyph: '○', word: 'blocked', color: 'var(--state-blocked)' },
}

export const LEGEND_ORDER: TicketState[] = ['closed', 'frontier', 'claimed', 'blocked']
