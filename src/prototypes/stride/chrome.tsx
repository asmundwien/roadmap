/**
 * PROTOTYPE — throwaway. Chrome shared across the flagline design, per the charting decisions:
 * the map child is self-contained (all map-specific data lives inside it) and the page-level
 * header carries the project details.
 *
 * The child does NOT render the map title or destination — the flag trigger owns both, so
 * identity never doubles. In `crop` mode (the accordion) the embedded ledger's own destination
 * section is cropped away, because the trigger IS that section, and a computed trunk tail bridges
 * the ledger's bottom padding so the solid rail runs unbroken into the older map below.
 */

import { type ReactNode, useMemo } from 'react'
import { stripInlineMarkdown } from '../../views/gist.ts'
import { buildLedger } from '../../views/map/geometry.ts'
import { MapLedger } from '../../views/map/ledger.tsx'
import { LEGEND_ORDER, STATE_META } from '../../views/map/state-meta.ts'
import type { StrideMap, StrideProject } from './fixture.ts'

/** The ledger renders at 1.25× its 840-unit viewBox (map.css); geometry units → px. */
const LEDGER_SCALE = 1.25

export function ProjectHead({ project }: { project: StrideProject }) {
  const tickets = project.maps.flatMap((m) => m.tickets)
  return (
    <header className="proto-project-head">
      <h2>
        {project.nameWithOwner}
        {project.isPrivate && <span className="proto-badge">private</span>}
      </h2>
      {/* The wayfinder states counted across the whole project — never a single map. */}
      <p className="proto-project-legend muted small">
        {LEGEND_ORDER.map((state) => (
          <span key={state} className="legend-item">
            <i aria-hidden="true" style={{ color: STATE_META[state].color }}>
              {STATE_META[state].glyph}
            </i>{' '}
            {STATE_META[state].word} · {tickets.filter((t) => t.state === state).length}
          </span>
        ))}
      </p>
    </header>
  )
}

/**
 * The self-contained map child: everything map-specific, identity excepted — the trigger owns it.
 * `crop` removes the ledger's destination section (the trigger already is that section) and adds
 * the trunk tail across the svg's bottom padding.
 */
export function MapChild({ map, crop = false }: { map: StrideMap; crop?: boolean }) {
  const geo = useMemo(() => buildLedger(map), [map])
  const textLeft = geo.textX * LEDGER_SCALE
  const partial = map.ticketsTruncated || map.tickets.some((t) => t.blockersTruncated)

  return (
    <div className="proto-child">
      <div className="proto-child-front" style={{ paddingLeft: textLeft }}>
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
      {crop ? <CroppedLedger map={map} /> : <MapLedger map={map} />}
    </div>
  )
}

/**
 * The node tree alone: the ledger minus its destination section — the flag trigger already is
 * that section — with a computed trunk tail across the svg's blank bottom padding so the solid
 * line runs unbroken into the older map below.
 */
export function CroppedLedger({ map }: { map: StrideMap }) {
  const geo = useMemo(() => buildLedger(map), [map])
  const cropPx = geo.sepFog * LEDGER_SCALE
  const tailPx = geo.trunkSolid ? (geo.height - geo.trunkSolid.y2) * LEDGER_SCALE : 0
  return (
    <div className="proto-crop">
      <div style={{ marginTop: -cropPx }}>
        <MapLedger map={map} />
      </div>
      {tailPx > 0 && <span className="proto-tail" style={{ height: tailPx }} aria-hidden="true" />}
    </div>
  )
}

/** The decided single-map grammar: no accordion chrome — the whole ledger bare, destination in. */
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
