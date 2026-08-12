/**
 * PROTOTYPE — throwaway. Variant B: CHRONICLE — the text-first thesis, round two.
 *
 * The collapsed stride stays a ground-covered row writ large — destination reached as the primary
 * text, title and count demoted — and the rail stays deliberately SEGMENTED: one solid chunk per
 * stride, a gap at every joint. That is this variant's answer to the trunk question: the accordion
 * is strides of a walk, not one drawn line, so the open map's ledger owns its own trunk and no
 * continuity is promised. Judge it against A's unbroken rail. Opening animates; the self-contained
 * child carries the map data.
 *
 * The card is its own fixed shape — deliberately NOT a miniature.
 */

import { stripInlineMarkdown } from '../../views/gist.ts'
import { SignalMeter } from '../../views/signal-meter.tsx'
import { BareMap, Fold, MapChild, ProjectHead } from './chrome.tsx'
import type { StrideMap } from './fixture.ts'
import type { CardProps, ScreenProps } from './variants.ts'

export const NAME = 'Chronicle — destination-first rows, segmented rail'

export function ScreenB({ project, openMap, onToggle }: ScreenProps) {
  const single = project.maps.length === 1 ? project.maps[0] : undefined
  return (
    <div className="vb-screen">
      <ProjectHead project={project} />

      {single ? (
        <BareMap map={single} />
      ) : (
        <div className="vb-trace">
          {project.maps.map((map) => (
            <StrideB
              key={map.number}
              map={map}
              active={map === project.active}
              open={openMap === map.number}
              onToggle={onToggle}
            />
          ))}
          {project.active === null && <p className="vb-rest muted small">at rest — trace intact</p>}
        </div>
      )}
    </div>
  )
}

function StrideB({
  map,
  active,
  open,
  onToggle,
}: {
  map: StrideMap
  active: boolean
  open: boolean
  onToggle: (n: number) => void
}) {
  const fog = map.body.notYetSpecified
  return (
    <div className={`vb-item${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className={`vb-stride${map.isOpen ? ' is-live' : ''}`}
        onClick={() => onToggle(map.number)}
      >
        <span
          className={`vb-seg${map.isOpen ? ' is-live' : ''}${active ? ' is-active' : ''}`}
          aria-hidden="true"
        />
        <span className="vb-body">
          <span className="vb-won">{stripInlineMarkdown(map.body.destination)}</span>
          <span className="vb-meta muted small">
            {map.title}
            {map.isOpen
              ? ` · travelling · ${map.updatedAt}`
              : ` · ${map.progress.completed} decided · ${map.closedAt}`}
          </span>
          {map.isOpen && !open && (
            <span className="vb-meter">
              <SignalMeter map={map} />
            </span>
          )}
          {!map.isOpen && fog.length > 0 && (
            <span className="vb-expired" title={fog.join(' · ')}>
              ◌ {fog.length} {fog.length === 1 ? 'patch' : 'patches'} seen, never entered
            </span>
          )}
        </span>
      </button>
      <Fold open={open}>
        <div className="vb-child">
          <MapChild map={map} />
        </div>
      </Fold>
    </div>
  )
}

export function CardB({ project, onOpen }: CardProps) {
  const closed = project.maps.filter((m) => !m.isOpen)
  const lastClosed = closed[closed.length - 1]
  return (
    <button type="button" className="proto-card vb-card" onClick={onOpen}>
      <span className="proto-card-name">{project.nameWithOwner}</span>
      {project.active ? (
        <>
          <span className="proto-card-gist muted">
            {stripInlineMarkdown(project.active.body.destination)}
          </span>
          <SignalMeter map={project.active} />
        </>
      ) : (
        <span className="proto-card-gist muted">
          at rest{lastClosed ? ` since ${lastClosed.closedAt}` : ''} — trace intact
        </span>
      )}
      <span className="vb-card-foot muted small">
        <span className="vb-card-dots" aria-hidden="true">
          {closed.map((map) => (
            <span key={map.number} className="vb-card-dot" />
          ))}
          {project.active && <span className="vb-card-dot is-head" />}
        </span>
        {closed.length === 0
          ? 'first journey'
          : `${closed.length} ${closed.length === 1 ? 'journey' : 'journeys'} behind`}
        {project.maps.filter((m) => m.isOpen).length > 1 && ' · 2 maps open'}
      </span>
    </button>
  )
}
