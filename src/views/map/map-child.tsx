import { type ReactNode, useMemo } from 'react'
import type { WayfinderMap } from '../../wayfinder/types.ts'
import { stripInlineMarkdown } from '../gist.ts'
import { buildLedger, LEDGER_SCALE } from './geometry.ts'
import { MapLedger } from './ledger.tsx'

/**
 * One map, self-contained, as the flagline settled it: the map IS its destination section — the
 * flag on its opaque halo, the caption, the destination at ledger scale, one `title · #n` meta
 * line — and that whole block is the accordion trigger. Opening it unfolds the node tree: the
 * ledger with its own destination section cropped away, since the trigger already is that
 * section. The asides ride inside the fold, indented into the text column so the rail's gutter
 * stays clear.
 */
export function MapChild({
  map,
  open,
  solo,
  last,
  onToggle,
}: {
  map: WayfinderMap
  open: boolean
  /** A single-map project has nothing to open or close against — no accordion, content only. */
  solo: boolean
  /** The earliest map is the journey's start: its trunk ends at the last decision, v1-style;
   * every other map runs its trunk to the svg's edge, into the map below. */
  last: boolean
  onToggle: (mapNumber: number) => void
}) {
  // Aligns the trigger's text with the embedded ledger's text column (exact at full render width).
  const textLeft = useMemo(() => buildLedger(map).textX * LEDGER_SCALE, [map])

  const header = (
    <>
      <span className="fl-flag" aria-hidden="true">
        ⚑
      </span>
      <span className="fl-body" style={{ marginLeft: textLeft }}>
        <span className="fl-caption">the destination</span>
        <span className="fl-dest">{stripInlineMarkdown(map.body.destination)}</span>
        <span className="fl-meta muted small">
          {map.title} · #{map.number}
        </span>
      </span>
    </>
  )

  const child = (
    <div className="fl-child">
      <CroppedLedger map={map} trunkToEdge={!last} />
      <MapAsides map={map} textLeft={textLeft} hasRail={!last} />
    </div>
  )

  if (solo) {
    return (
      <article className="fl-block is-open">
        <div className="fl-trigger is-static">{header}</div>
        {child}
      </article>
    )
  }

  return (
    <article className={`fl-block${open ? ' is-open' : ''}`}>
      <button type="button" className="fl-trigger" onClick={() => onToggle(map.number)}>
        {header}
      </button>
      <Fold open={open}>{child}</Fold>
    </article>
  )
}

/**
 * The node tree alone: the ledger minus its destination section. `trunkToEdge` asks the ledger
 * to draw its solid trunk to its own bottom edge, so the rail continues into the older map below
 * inside the svg itself — same stroke, same scale, no overlay.
 */
function CroppedLedger({ map, trunkToEdge }: { map: WayfinderMap; trunkToEdge: boolean }) {
  const cropPx = useMemo(() => buildLedger(map).sepFog * LEDGER_SCALE, [map])
  return (
    <div className="fl-crop">
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
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`fold${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="fold-inner">{children}</div>
    </div>
  )
}

/** The click-away tier: Notes, Out of scope, data-honesty warnings, and the map's GitHub link. */
function MapAsides({
  map,
  textLeft,
  hasRail,
}: {
  map: WayfinderMap
  textLeft: number
  hasRail: boolean
}) {
  const partial = map.ticketsTruncated || map.tickets.some((ticket) => ticket.blockersTruncated)

  return (
    <footer className={`fl-asides${hasRail ? ' has-rail' : ''}`} style={{ paddingLeft: textLeft }}>
      {partial && (
        <p className="muted small">
          Partial view — GitHub returned only the first page of{' '}
          {map.ticketsTruncated ? 'tickets' : 'some tickets’ blockers'}.
        </p>
      )}
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
      <p className="muted small fl-github">
        <a href={map.url} target="_blank" rel="noreferrer">
          #{map.number} on GitHub{map.isOpen ? '' : ' · closed'}
        </a>
      </p>
    </footer>
  )
}
