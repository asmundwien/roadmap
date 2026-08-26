import type { WayfinderMap } from '@roadmap/contracts'
import { type ReactNode, useMemo } from 'react'
import type { ResolvedSelection } from '../../router.ts'
import { stripInlineMarkdown } from '../gist.ts'
import { buildLedger, LEDGER_SCALE } from './geometry.ts'
import { MapLedger } from './ledger.tsx'
import './map.css'
import type { LedgerSelection } from './sequence.ts'

/**
 * One map, self-contained: the trigger is inverted — the map title big, the destination prose a
 * one-line gist — and that whole block is the accordion trigger AND an item like any other. The
 * map renders titles only; every descriptive text lives in the docked Panel, which the project
 * screen owns. Opening the accordion unfolds the node tree: the ledger with its own destination
 * section cropped away, since the trigger already is that section.
 */
export function MapChild({
  map,
  open,
  solo,
  last,
  onSelect,
  onUnfold,
  panelOpen,
  selected,
  entry,
  kbNav,
}: {
  map: WayfinderMap
  open: boolean
  /** A single-map project has nothing to open or close against — no accordion, content only. */
  solo: boolean
  /** The earliest map is the journey's start: its trunk ends at the last decision, every other
   * map runs its trunk to the svg's edge, into the map below. */
  last: boolean
  onSelect: (item: ResolvedSelection) => void
  /** Re-pin the hash to this map so its accordion unfolds — without touching the selection. */
  onUnfold: () => void
  panelOpen: boolean
  selected: ResolvedSelection | null
  kbNav: boolean
  entry: boolean
}) {
  const textLeft = useMemo(() => buildLedger(map).textX * LEDGER_SCALE, [map])
  const partial = !map.ticketsComplete || map.tickets.some((ticket) => !ticket.blockersComplete)
  const ledgerSelected = selected !== null && selected.kind !== 'map' ? selected : null
  const isMapSelected = selected?.kind === 'map'

  const header = (
    <>
      <span className="fl-flag" aria-hidden="true">
        ⚑
      </span>
      <span className="fl-body" style={{ marginLeft: textLeft }}>
        <span className="fl-caption">the destination</span>
        <span className="fl-title">{map.title}</span>
        <span className="fl-gist">{stripInlineMarkdown(map.body.destination)}</span>
        {partial && (
          <span className="fl-meta muted small">
            <span className="fl-flaw">partial view</span>
          </span>
        )}
      </span>
    </>
  )

  const child = (
    <div className="fl-child">
      <CroppedLedger
        map={map}
        trunkToEdge={!last}
        onSelect={onSelect}
        selected={ledgerSelected}
        kbNav={kbNav}
      />
    </div>
  )

  const charted = map.isOpen ? ' is-charted' : ''
  const expanded = solo || open
  const activate = () => {
    if (!expanded && !panelOpen) {
      onUnfold()
      return
    }
    onSelect({ kind: 'map' })
  }

  return (
    <article className={`fl-block${expanded ? ' is-open' : ''}${charted}`}>
      <div className={`fl-trigger${isMapSelected ? ' is-selected' : ''}`}>
        <button
          type="button"
          className="fl-hit"
          data-nav-item="true"
          data-selected={isMapSelected ? 'true' : 'false'}
          tabIndex={isMapSelected || entry ? 0 : -1}
          aria-label={`${map.title} — the destination`}
          aria-current={isMapSelected ? 'true' : undefined}
          aria-expanded={solo ? undefined : open}
          onClick={activate}
        />
        {header}
      </div>
      {solo ? child : <Fold open={open}>{child}</Fold>}
    </article>
  )
}

/** True when two picks point at the same thing — how the Panel finds itself in the sequence. */
export function sameSelection(a: ResolvedSelection, b: ResolvedSelection): boolean {
  if (a.kind === 'ticket') return b.kind === 'ticket' && b.id === a.id
  if (a.kind === 'fog') return b.kind === 'fog' && b.text === a.text
  if (a.kind === 'scope') return b.kind === 'scope' && b.text === a.text
  return a.kind === b.kind
}

function CroppedLedger({
  map,
  trunkToEdge,
  onSelect,
  selected,
  kbNav,
}: {
  map: WayfinderMap
  trunkToEdge: boolean
  onSelect: (selection: LedgerSelection) => void
  selected: LedgerSelection | null
  kbNav: boolean
}) {
  const cropPx = useMemo(() => buildLedger(map).sepFog * LEDGER_SCALE, [map])
  return (
    <div className="fl-crop">
      <div style={{ marginTop: -cropPx }}>
        <MapLedger
          map={map}
          trunkToEdge={trunkToEdge}
          onSelect={onSelect}
          selected={selected}
          kbNav={kbNav}
        />
      </div>
    </div>
  )
}

function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`fold${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="fold-inner">{children}</div>
    </div>
  )
}
