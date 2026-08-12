/**
 * PROTOTYPE — throwaway. Variant B: CHRONICLE — the text-first thesis.
 *
 * The collapsed stride is a ground-covered ledger row writ large: the DESTINATION REACHED is the
 * primary text (what the journey won), the map title and count demoted to the second line. The
 * rail is segmented, not continuous — each stride carries its own short solid segment with a gap
 * at the accordion joints, so the trace reads as strides of a walk. Expired fog is a third line.
 *
 * The card is its own shape — a deliberate NON-miniature: active destination + meter + a one-line
 * journey footnote with a ✓-dot per closed map. Constant height however long the history.
 */

import { stripInlineMarkdown } from '../../views/gist.ts'
import { MapLedger } from '../../views/map/ledger.tsx'
import { SignalMeter } from '../../views/signal-meter.tsx'
import type { StrideMap } from './fixture.ts'
import type { CardProps, ScreenProps } from './variants.ts'

export const NAME = 'Chronicle — destination-first rows, segmented rail'

export function ScreenB({ project, openMap, onToggle }: ScreenProps) {
  const single = project.maps.length === 1 ? project.maps[0] : undefined
  return (
    <div className="vb-screen">
      <header className="proto-project-head">
        <h2>{project.nameWithOwner}</h2>
        <p className="muted small">
          {project.active
            ? `travelling · ${project.active.updatedAt}`
            : 'resting — every map closed'}
        </p>
      </header>

      {single ? (
        <BareChild map={single} />
      ) : (
        <div className="vb-trace">
          {project.maps.map((map) =>
            openMap === map.number ? (
              <OpenStrideB key={map.number} map={map} onToggle={onToggle} />
            ) : (
              <CollapsedStrideB
                key={map.number}
                map={map}
                active={map === project.active}
                onToggle={onToggle}
              />
            ),
          )}
          {project.active === null && <p className="vb-rest muted small">at rest — trace intact</p>}
        </div>
      )}
    </div>
  )
}

function CollapsedStrideB({
  map,
  active,
  onToggle,
}: {
  map: StrideMap
  active: boolean
  onToggle: (n: number) => void
}) {
  const fog = map.body.notYetSpecified
  return (
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
        {map.isOpen && (
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
  )
}

function OpenStrideB({ map, onToggle }: { map: StrideMap; onToggle: (n: number) => void }) {
  return (
    <section className="vb-open">
      <button type="button" className="vb-open-head" onClick={() => onToggle(map.number)}>
        <span className="vb-won">{map.title}</span>
        <span className="vb-meta muted small">
          #{map.number} · {map.isOpen ? map.updatedAt : `closed ${map.closedAt}`} — click to fold
        </span>
      </button>
      <MapLedger map={map} />
    </section>
  )
}

function BareChild({ map }: { map: StrideMap }) {
  return (
    <section>
      <p className="muted small proto-eyebrow">
        #{map.number} · {map.isOpen ? map.updatedAt : `closed ${map.closedAt}`}
      </p>
      <h3 className="proto-child-title">{map.title}</h3>
      <MapLedger map={map} />
    </section>
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
