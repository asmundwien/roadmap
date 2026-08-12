/**
 * PROTOTYPE — throwaway. Chrome shared across the flagline design: the page-level header carries
 * the project details (title plus the state legend counted across the whole project), and every
 * map — single-map projects included — goes through the same flag trigger and cropped ledger.
 */

import { type ReactNode, useMemo } from 'react'
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
 * The node tree alone: the ledger minus its destination section — the flag trigger already is
 * that section. `trunkToEdge` asks the ledger to draw its solid trunk to its own bottom edge,
 * so the rail continues into the older map below inside the svg itself: same stroke, same
 * scale, no overlay.
 */
export function CroppedLedger({ map, trunkToEdge }: { map: StrideMap; trunkToEdge: boolean }) {
  const geo = useMemo(() => buildLedger(map), [map])
  const cropPx = geo.sepFog * LEDGER_SCALE
  return (
    <div className="proto-crop">
      <div style={{ marginTop: -cropPx }}>
        <MapLedger map={map} trunkToEdge={trunkToEdge} />
      </div>
    </div>
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
