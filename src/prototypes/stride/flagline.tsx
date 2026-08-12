/**
 * PROTOTYPE — throwaway. Round three: THE FLAGLINE — the destination is the header.
 *
 * The round-two reaction and the stride-joint research converged on the same finding: the
 * accordion header and the ledger's destination block are the same element drawn twice. Now they
 * are one. Maps are ordered the way the ledger reads — active map at the top, history descending
 * into the past — and each map renders as its DESTINATION SECTION: the flag with its halo and the
 * destination text at ledger scale. That whole block is the accordion trigger. Opening a map
 * unfolds the node graph beneath it (the embedded ledger with its own destination section cropped
 * away — the trigger already is that section), and the solid trunk exits the ground-covered end
 * into the older map below: one line from the active destination down to the journey's origin.
 *
 * Stepped back per the round-three reaction: the trigger is a faithful recreation of the ledger's
 * destination section — its icon, caption, colors, and rendered dimensions — identical for every
 * map. No open-state morphs, no reached/live color split; the fold is the only motion.
 */

import { useMemo } from 'react'
import { stripInlineMarkdown } from '../../views/gist.ts'
import { buildLedger } from '../../views/map/geometry.ts'
import { CroppedLedger, Fold, ProjectHead } from './chrome.tsx'
import type { StrideMap, StrideProject } from './fixture.ts'

export interface ScreenProps {
  project: StrideProject
  /** Number of the map whose graph is unfolded; null = fully collapsed (the resting default). */
  openMap: number | null
  onToggle: (mapNumber: number) => void
}

export interface CardProps {
  project: StrideProject
  onOpen: () => void
}

export function FlaglineScreen({ project, openMap, onToggle }: ScreenProps) {
  const newestFirst = [...project.maps].reverse()
  return (
    <div className="fl-screen">
      <ProjectHead project={project} />
      <div className="fl-trace">
        {newestFirst.map((map, i) => (
          <FlagBlock
            key={map.number}
            map={map}
            open={openMap === map.number}
            // The earliest map is the journey's start: its trunk ends at the last decision,
            // v1-style; every other open map runs its trunk to the edge, into the map below.
            last={i === newestFirst.length - 1}
            // A single map has nothing to open or close against — no accordion, content only.
            solo={newestFirst.length === 1}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  )
}

function FlagBlock({
  map,
  open,
  last,
  solo,
  onToggle,
}: {
  map: StrideMap
  open: boolean
  last: boolean
  solo: boolean
  onToggle: (n: number) => void
}) {
  // Aligns the trigger's text with the embedded ledger's text column (exact at full render width).
  const textLeft = useMemo(() => buildLedger(map).textX * 1.25, [map])
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
    </div>
  )

  if (solo) {
    return (
      <div className="fl-block is-open">
        <div className="fl-trigger is-static">{header}</div>
        {child}
      </div>
    )
  }

  return (
    <div className={`fl-block${open ? ' is-open' : ''}`}>
      <button type="button" className="fl-trigger" onClick={() => onToggle(map.number)}>
        {header}
      </button>
      <Fold open={open}>{child}</Fold>
    </div>
  )
}

/** The card is the screen at a second density: the same flag-led lines, newest first. */
export function FlaglineCard({ project, onOpen }: CardProps) {
  const newestFirst = [...project.maps].reverse()
  return (
    <button type="button" className="proto-card fl-card" onClick={onOpen}>
      <span className="proto-card-name">{project.nameWithOwner}</span>
      <span className="fl-card-trace">
        {newestFirst.map((map) => (
          <span key={map.number} className="fl-card-line">
            <span className="fl-card-flag" aria-hidden="true">
              ⚑
            </span>
            <span className={`fl-card-dest${map === project.active ? ' is-active' : ''}`}>
              {stripInlineMarkdown(map.body.destination)}
            </span>
            <span className="fl-card-tail muted">{map.isOpen ? map.updatedAt : map.closedAt}</span>
          </span>
        ))}
      </span>
    </button>
  )
}
