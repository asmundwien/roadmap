/**
 * PROTOTYPE — throwaway. The header and the state vocabulary, shared across variants because they
 * are not what is being decided. Layout is not shared: each variant owns its own.
 */

import type { TicketState, WayfinderMap } from '../../wayfinder/types.ts'

/**
 * A glyph and a word per state, so colour is never the only channel — the dataviz rule for status
 * palettes, and the relief the light-mode magenta needs to earn its place.
 */
export const STATE_META: Record<TicketState, { glyph: string; word: string; color: string }> = {
  closed: { glyph: '●', word: 'decided', color: 'var(--state-closed)' },
  frontier: { glyph: '◆', word: 'takeable', color: 'var(--state-frontier)' },
  claimed: { glyph: '◐', word: 'claimed', color: 'var(--state-claimed)' },
  blocked: { glyph: '○', word: 'blocked', color: 'var(--state-blocked)' },
}

const LEGEND_ORDER: TicketState[] = ['closed', 'frontier', 'claimed', 'blocked']

export function StateGlyph({ state }: { state: TicketState }) {
  const meta = STATE_META[state]
  return (
    <i aria-hidden="true" style={{ color: meta.color, fontStyle: 'normal' }}>
      {meta.glyph}
    </i>
  )
}

/**
 * Round two: the destination is no longer in the header — the success criteria pin it at the far
 * end of each variant's travel axis, so every canvas places it itself.
 */
export function MapHead({ map, children }: { map: WayfinderMap; children?: React.ReactNode }) {
  return (
    <header className="proto-head">
      <div className="repo">
        {map.nameWithOwner} · #{map.number}
      </div>
      <h1>
        <a href={map.url}>{map.title}</a>
      </h1>
      {children}
      <div className="proto-legend">
        {LEGEND_ORDER.map((state) => (
          <span key={state}>
            <StateGlyph state={state} />
            {STATE_META[state].word} ·{' '}
            {map.tickets.filter((t) => t.state === state).length.toString()}
          </span>
        ))}
      </div>
    </header>
  )
}
