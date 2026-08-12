import type { WayfinderMap } from '../../wayfinder/types.ts'
import { stripInlineMarkdown } from '../gist.ts'
import { SignalMeter } from '../signal-meter.tsx'
import { MapLedger } from './ledger.tsx'
import { LEGEND_ORDER, STATE_META } from './state-meta.ts'

/**
 * One map, self-contained: title, counts, meter, ledger, and the click-away asides. It carries
 * everything map-specific so the shell around it stays at project altitude — today it renders
 * bare under the project header, and the accordion will mount it as a child unchanged.
 */
export function MapChild({ map }: { map: WayfinderMap }) {
  return (
    <article>
      <MapHead map={map} />
      <MapLedger map={map} />
      <MapAsides map={map} />
    </article>
  )
}

function MapHead({ map }: { map: WayfinderMap }) {
  const partial = map.ticketsTruncated || map.tickets.some((ticket) => ticket.blockersTruncated)

  return (
    <header className="map-head">
      <p className="muted small map-eyebrow">
        #{map.number}
        {!map.isOpen && ' · closed'}
      </p>
      <h2>
        <a href={map.url}>{map.title}</a>
      </h2>
      <div className="map-meta muted small">
        {LEGEND_ORDER.map((state) => (
          <span key={state} className="legend-item">
            <i aria-hidden="true" style={{ color: STATE_META[state].color }}>
              {STATE_META[state].glyph}
            </i>{' '}
            {STATE_META[state].word} ·{' '}
            {map.tickets.filter((ticket) => ticket.state === state).length}
          </span>
        ))}
      </div>
      <SignalMeter map={map} />
      {partial && (
        <p className="muted small">
          Partial view — GitHub returned only the first page of{' '}
          {map.ticketsTruncated ? 'tickets' : 'some tickets’ blockers'}.
        </p>
      )}
    </header>
  )
}

/** The click-away tier: Notes and Out of scope, plus the drift signal if the body has one. */
function MapAsides({ map }: { map: WayfinderMap }) {
  return (
    <footer>
      {map.body.notes.length > 0 && (
        <details className="map-aside">
          <summary>Notes</summary>
          <ul>
            {map.body.notes.map((note) => (
              <li key={note}>{stripInlineMarkdown(note)}</li>
            ))}
          </ul>
        </details>
      )}
      {map.body.outOfScope.length > 0 && (
        <details className="map-aside">
          <summary>Out of scope</summary>
          <ul>
            {map.body.outOfScope.map((item) => (
              <li key={item}>{stripInlineMarkdown(item)}</li>
            ))}
          </ul>
        </details>
      )}
      {map.body.missingSections.length > 0 && (
        <p className="muted small">
          Map body is missing sections: {map.body.missingSections.join(', ')}.
        </p>
      )}
    </footer>
  )
}
