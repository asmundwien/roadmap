/**
 * PROTOTYPE — throwaway. Chrome shared by every variant, per the charting decisions the reaction
 * pointed back to: the map child is self-contained (all map-specific data lives inside it) and the
 * page-level header carries the project details. Both are designed once here; variants keep
 * differing on the collapsed stride's anatomy and the card's shape.
 *
 * The child deliberately does NOT render the map title — the accordion header owns it and morphs
 * into the open state's heading, so title identity never doubles. The child's front-matter (meta,
 * legend, notes, out-of-scope) sits ABOVE the ledger so the ledger's trunk ends the child and the
 * rail can run on into the next stride without a break.
 */

import type { ReactNode } from 'react'
import { stripInlineMarkdown } from '../../views/gist.ts'
import { MapLedger } from '../../views/map/ledger.tsx'
import { LEGEND_ORDER, STATE_META } from '../../views/map/state-meta.ts'
import type { StrideMap, StrideProject } from './fixture.ts'

export function ProjectHead({ project }: { project: StrideProject }) {
  const closed = project.maps.filter((m) => !m.isOpen).length
  const open = project.maps.length - closed
  return (
    <header className="proto-project-head">
      <h2>
        {project.nameWithOwner}
        {project.isPrivate && <span className="proto-badge">private</span>}
      </h2>
      <p className="muted small">
        {project.active ? `travelling · ${project.active.updatedAt}` : 'resting — every map closed'}
        {' · '}
        {project.maps.length === 1 ? 'one map' : `${project.maps.length} maps`}
        {closed > 0 && open > 0 && ` — ${closed} closed, ${open === 1 ? 'one' : open} open`}
        {' · '}
        <a href={`https://github.com/${project.nameWithOwner}`}>on GitHub</a>
      </p>
    </header>
  )
}

/** The self-contained map child: everything map-specific, title excepted — the header owns it. */
export function MapChild({ map }: { map: StrideMap }) {
  const partial = map.ticketsTruncated || map.tickets.some((t) => t.blockersTruncated)
  return (
    <div className="proto-child">
      <div className="proto-child-front">
        <div className="proto-child-meta muted small">
          <span>#{map.number}</span>
          <span>{map.isOpen ? `updated ${map.updatedAt}` : `closed ${map.closedAt}`}</span>
          {LEGEND_ORDER.map((state) => (
            <span key={state} className="legend-item">
              <i aria-hidden="true" style={{ color: STATE_META[state].color }}>
                {STATE_META[state].glyph}
              </i>{' '}
              {STATE_META[state].word} · {map.tickets.filter((t) => t.state === state).length}
            </span>
          ))}
        </div>
        {partial && (
          <p className="muted small">Partial view — GitHub returned only the first page.</p>
        )}
        {map.body.notes.length > 0 && (
          <details className="proto-aside">
            <summary>Notes</summary>
            <ul>
              {map.body.notes.map((note) => (
                <li key={note}>{stripInlineMarkdown(note)}</li>
              ))}
            </ul>
          </details>
        )}
        {map.body.outOfScope.length > 0 && (
          <details className="proto-aside">
            <summary>Out of scope</summary>
            <ul>
              {map.body.outOfScope.map((item) => (
                <li key={item}>{stripInlineMarkdown(item)}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <MapLedger map={map} />
    </div>
  )
}

/** The decided single-map grammar: no accordion chrome, the map child bare under its title. */
export function BareMap({ map }: { map: StrideMap }) {
  return (
    <section>
      <h3 className="proto-child-title">{map.title}</h3>
      <MapChild map={map} />
    </section>
  )
}

/**
 * The animated single-open fold: always mounted so the open/close motion has content to move.
 * grid-template-rows 0fr→1fr is the transition — no measured heights, no jump at the end.
 */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`proto-fold${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="proto-fold-inner">{children}</div>
    </div>
  )
}
