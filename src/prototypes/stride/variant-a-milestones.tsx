/**
 * PROTOTYPE — throwaway. Variant A: MILESTONES — the miniature thesis, round two.
 *
 * Round-one reaction fixes carried here: the map-level mark is now a PLAQUE — a rounded square,
 * a different family from every circular ticket node inside a ledger — and the collapsed stride
 * carries the destination gist so it reads as a whole map, not a task row. The rail runs
 * unbroken: solid through the collapsed past, a dashed joint through the open child's
 * front-matter into the ledger's destination flag, and the ledger's own trunk carries it out the
 * bottom into the next stride. Opening and closing animates.
 *
 * The card remains LITERALLY the screen at a second density — one component, two densities.
 */

import { stripInlineMarkdown } from '../../views/gist.ts'
import { SignalMeter } from '../../views/signal-meter.tsx'
import { BareMap, Fold, MapChild, ProjectHead } from './chrome.tsx'
import type { StrideMap } from './fixture.ts'
import type { CardProps, ScreenProps } from './variants.ts'

export const NAME = 'Milestones — one component, two densities'

export function ScreenA({ project, openMap, onToggle }: ScreenProps) {
  const single = project.maps.length === 1 ? project.maps[0] : undefined
  return (
    <div className="va-screen">
      <ProjectHead project={project} />

      {single ? (
        <BareMap map={single} />
      ) : (
        <div className="va-trace">
          {project.maps.map((map) => (
            <StrideA
              key={map.number}
              map={map}
              active={map === project.active}
              open={openMap === map.number}
              onToggle={onToggle}
            />
          ))}
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

function StrideA({
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
  const fog = map.body.notYetSpecified.length
  return (
    <div className={`va-item${open ? ' is-open' : ''}`}>
      <button type="button" className="va-stride" onClick={() => onToggle(map.number)}>
        <span
          className={`va-plaque${map.isOpen ? ` is-live${active ? ' is-active' : ''}` : ' is-done'}`}
          aria-hidden="true"
        />
        <span className="va-text">
          <span className="va-stride-title">{map.title}</span>
          <span className="va-stride-gist muted">{stripInlineMarkdown(map.body.destination)}</span>
        </span>
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
      <Fold open={open}>
        <div className="va-child">
          <MapChild map={map} />
        </div>
      </Fold>
    </div>
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
            <span
              className={`va-card-plaque${
                map.isOpen ? ` is-live${map === project.active ? ' is-active' : ''}` : ' is-done'
              }`}
              aria-hidden="true"
            />
            <span className={`va-card-title${map === project.active ? ' is-active' : ''}`}>
              {map.title.replace(/ — Wayfinder Map$/, '')}
            </span>
            <span className="va-card-tail muted">{map.isOpen ? map.updatedAt : map.closedAt}</span>
          </span>
        ))}
        {project.active === null && (
          <span className="va-card-line">
            <span className="va-card-plaque is-rest" aria-hidden="true" />
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
