/**
 * PROTOTYPE — throwaway. Variant A: MILESTONES — the miniature thesis.
 *
 * The collapsed stride is a mile-marker: one continuous solid rail runs the full journey, and each
 * closed map sits on it as a large ✓ node with the map title and a right-aligned tail (decided
 * count · close date, expired fog as a ghost count). A secondary open map is a live ring with its
 * meter in the tail. The active map opens in place and the embedded ledger's trunk continues at
 * the same x, so the accordion reads as one rail.
 *
 * The card is LITERALLY the screen at a second density: the same stride list, smaller — one
 * component, two densities. Judge whether that survives a long history.
 */

import { stripInlineMarkdown } from '../../views/gist.ts'
import { MapLedger } from '../../views/map/ledger.tsx'
import { SignalMeter } from '../../views/signal-meter.tsx'
import type { StrideMap } from './fixture.ts'
import type { CardProps, ScreenProps } from './variants.ts'

export const NAME = 'Milestones — one component, two densities'

export function ScreenA({ project, openMap, onToggle }: ScreenProps) {
  const single = project.maps.length === 1 ? project.maps[0] : undefined
  return (
    <div className="va-screen">
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
        <div className="va-trace">
          {project.maps.map((map) =>
            openMap === map.number ? (
              <OpenStrideA key={map.number} map={map} onToggle={onToggle} />
            ) : (
              <CollapsedStrideA
                key={map.number}
                map={map}
                active={map === project.active}
                onToggle={onToggle}
              />
            ),
          )}
          {project.active === null && (
            <p className="va-rest">
              <span className="va-rest-cap" aria-hidden="true" />
              at rest — trace intact
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function CollapsedStrideA({
  map,
  active,
  onToggle,
}: {
  map: StrideMap
  active: boolean
  onToggle: (n: number) => void
}) {
  const fog = map.body.notYetSpecified.length
  return (
    <button type="button" className="va-stride" onClick={() => onToggle(map.number)}>
      {map.isOpen ? (
        <span className={`va-node va-node-live${active ? ' is-active' : ''}`} aria-hidden="true" />
      ) : (
        <span className="va-node va-node-done" aria-hidden="true">
          ✓
        </span>
      )}
      <span className="va-stride-title">{map.title}</span>
      <span className="va-tail">
        {!map.isOpen && fog > 0 && (
          <span className="va-ghost" title={map.body.notYetSpecified.join(' · ')}>
            <span className="va-ghost-dot" aria-hidden="true" />
            {fog} unentered
          </span>
        )}
        {map.isOpen ? (
          <>
            <span className="va-tail-meter">
              <SignalMeter map={map} />
            </span>
            <span className="muted small">
              {active ? map.updatedAt : `live · ${map.updatedAt}`}
            </span>
          </>
        ) : (
          <span className="muted small">
            {map.progress.completed} decided · {map.closedAt}
          </span>
        )}
      </span>
    </button>
  )
}

function OpenStrideA({ map, onToggle }: { map: StrideMap; onToggle: (n: number) => void }) {
  return (
    <section className="va-open">
      <button type="button" className="va-stride is-open" onClick={() => onToggle(map.number)}>
        <span
          className={`va-node ${map.isOpen ? 'va-node-here' : 'va-node-done'}`}
          aria-hidden="true"
        >
          {map.isOpen ? '' : '✓'}
        </span>
        <span className="va-stride-title">{map.title}</span>
        <span className="va-tail">
          <span className="muted small">
            {map.isOpen ? map.updatedAt : `closed ${map.closedAt}`} · #{map.number}
          </span>
        </span>
      </button>
      <MapLedger map={map} />
    </section>
  )
}

/** The decided single-map grammar: no accordion chrome, the map child bare. Same in every variant. */
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

export function CardA({ project, onOpen }: CardProps) {
  return (
    <button type="button" className="proto-card va-card" onClick={onOpen}>
      <span className="proto-card-name">{project.nameWithOwner}</span>
      <span className="va-card-trace">
        <span className="va-card-rail" aria-hidden="true" />
        {project.maps.map((map) => (
          <span key={map.number} className="va-card-line">
            {map.isOpen ? (
              <span
                className={`va-card-node is-live${map === project.active ? ' is-active' : ''}`}
                aria-hidden="true"
              />
            ) : (
              <span className="va-card-node is-done" aria-hidden="true" />
            )}
            <span className={`va-card-title${map === project.active ? ' is-active' : ''}`}>
              {map.title.replace(/ — Wayfinder Map$/, '')}
            </span>
            <span className="va-card-tail muted">{map.isOpen ? map.updatedAt : map.closedAt}</span>
          </span>
        ))}
        {project.active === null && (
          <span className="va-card-line">
            <span className="va-card-node is-rest" aria-hidden="true" />
            <span className="va-card-title muted">at rest</span>
          </span>
        )}
      </span>
      {project.active && (
        <span className="proto-card-gist muted">
          {stripInlineMarkdown(project.active.body.destination)}
        </span>
      )}
    </button>
  )
}
