/**
 * PROTOTYPE — throwaway. Variant C: STRATA — the density thesis, round two.
 *
 * Collapsed maps stay strata: one continuous rail, a tick per decision, height as ground covered,
 * expired fog as a ghost scatter at the foot. Round-two fixes: the open map's header mark is a
 * PLAQUE (rounded square — the map-level family, distinct from every circular ticket node), the
 * open child is the self-contained map child with a dashed joint carrying the rail into the
 * ledger's flag, and opening animates.
 *
 * The card rotates the rail horizontal: segment lengths encode each map's decisions, plaque head
 * if travelling, cap if at rest.
 */

import { stripInlineMarkdown } from '../../views/gist.ts'
import { SignalMeter } from '../../views/signal-meter.tsx'
import { BareMap, Fold, MapChild, ProjectHead } from './chrome.tsx'
import type { StrideMap } from './fixture.ts'
import type { CardProps, ScreenProps } from './variants.ts'

export const NAME = 'Strata — a tick per decision, weight as height'

const RAIL_X = 55
const TICK_PITCH = 12
const STRATUM_PAD = 14

export function ScreenC({ project, openMap, onToggle }: ScreenProps) {
  const single = project.maps.length === 1 ? project.maps[0] : undefined
  return (
    <div className="vc-screen">
      <ProjectHead project={project} />

      {single ? (
        <BareMap map={single} />
      ) : (
        <div className="vc-trace">
          {project.maps.map((map) => (
            <StrideC
              key={map.number}
              map={map}
              active={map === project.active}
              open={openMap === map.number}
              onToggle={onToggle}
            />
          ))}
          {project.active === null && (
            <div className="vc-rest-row">
              <svg width="110" height="34" aria-hidden="true">
                <line
                  x1={RAIL_X}
                  y1="0"
                  x2={RAIL_X}
                  y2="20"
                  stroke="var(--fg)"
                  strokeOpacity="0.55"
                  strokeWidth="2.5"
                />
                <line
                  x1={RAIL_X - 8}
                  y1="21"
                  x2={RAIL_X + 8}
                  y2="21"
                  stroke="var(--fg)"
                  strokeOpacity="0.55"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              <p className="muted small">at rest — trace intact</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StrideC({
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
  return (
    <div className={`vc-item${open ? ' is-open' : ''}`}>
      <button type="button" className="vc-stride" onClick={() => onToggle(map.number)}>
        {open ? <PlaqueGutter /> : <StratumGutter map={map} />}
        <span className="vc-body">
          <span className="vc-title">{map.title}</span>
          {!open && (
            <span className="vc-gist muted">{stripInlineMarkdown(map.body.destination)}</span>
          )}
          <span className="muted small">
            {map.isOpen
              ? `${map.progress.completed} decided so far · ${active ? '' : 'live · '}${map.updatedAt}`
              : `${map.progress.completed} decided · closed ${map.closedAt}`}
            {!map.isOpen &&
              map.body.notYetSpecified.length > 0 &&
              ` · ${map.body.notYetSpecified.length} fog unentered`}
            {open && ' — click to fold'}
          </span>
          {map.isOpen && !open && (
            <span className="vc-meter">
              <SignalMeter map={map} />
            </span>
          )}
        </span>
      </button>
      <Fold open={open}>
        <div className="vc-child">
          <MapChild map={map} />
        </div>
      </Fold>
    </div>
  )
}

/** The collapsed stratum: rail plus a tick per decision, ghost scatter for expired fog. */
function StratumGutter({ map }: { map: StrideMap }) {
  const decided = map.progress.completed
  const openCount = map.progress.total - decided
  const fog = map.body.notYetSpecified
  const ticks = map.isOpen ? decided + openCount : decided
  const height = Math.max(44, ticks * TICK_PITCH + STRATUM_PAD * 2)

  return (
    <svg width="110" height={height} className="vc-gutter" aria-hidden="true">
      <line
        x1={RAIL_X}
        y1="0"
        x2={RAIL_X}
        y2={height}
        stroke="var(--fg)"
        strokeOpacity="0.55"
        strokeWidth="2.5"
      />
      {Array.from({ length: decided }, (_, i) => (
        <line
          // biome-ignore lint/suspicious/noArrayIndexKey: ticks are anonymous marks
          key={i}
          x1={RAIL_X - 8}
          y1={STRATUM_PAD + i * TICK_PITCH + TICK_PITCH / 2}
          x2={RAIL_X + 8}
          y2={STRATUM_PAD + i * TICK_PITCH + TICK_PITCH / 2}
          stroke="var(--fg)"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      {map.isOpen &&
        Array.from({ length: openCount }, (_, i) => (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: ticks are anonymous marks
            key={`open-${i}`}
            x1={RAIL_X - 5}
            y1={STRATUM_PAD + (decided + i) * TICK_PITCH + TICK_PITCH / 2}
            x2={RAIL_X + 5}
            y2={STRATUM_PAD + (decided + i) * TICK_PITCH + TICK_PITCH / 2}
            stroke="var(--muted)"
            strokeOpacity="0.6"
            strokeWidth="1.5"
            strokeDasharray="2 3"
          />
        ))}
      {!map.isOpen &&
        fog
          .slice(0, 3)
          .map((item, i) => (
            <circle
              key={item}
              cx={RAIL_X + 16 + (i % 2) * 11}
              cy={height - 10 - i * 9}
              r="4"
              fill="none"
              stroke="var(--muted)"
              strokeWidth="1.5"
              strokeDasharray="2 3"
              strokeOpacity="0.7"
            />
          ))}
    </svg>
  )
}

/** The open header's mark: the map-level plaque on the rail — square family, never a circle. */
function PlaqueGutter() {
  return (
    <svg width="110" height="44" aria-hidden="true">
      <line
        x1={RAIL_X}
        y1="0"
        x2={RAIL_X}
        y2="44"
        stroke="var(--fg)"
        strokeOpacity="0.55"
        strokeWidth="2.5"
      />
      <rect
        x={RAIL_X - 9}
        y={22 - 9}
        width="18"
        height="18"
        rx="4"
        fill="var(--bg)"
        stroke="var(--fg)"
        strokeWidth="2.5"
      />
      <rect x={RAIL_X - 3} y={22 - 3} width="6" height="6" rx="1.5" fill="var(--fg)" />
    </svg>
  )
}

const SEG_BASE = 16
const SEG_PER_DECISION = 7
const SEG_GAP = 6
const STRIP_H = 30
const STRIP_Y = 15

export function CardC({ project, onOpen }: CardProps) {
  const closed = project.maps.filter((m) => !m.isOpen)
  const segments = closed.map((map) => SEG_BASE + map.progress.completed * SEG_PER_DECISION)
  const stripLen =
    8 + segments.reduce((sum, len) => sum + len + SEG_GAP, 0) + (project.active ? 14 : 8)

  let cursor = 8
  const drawn = segments.map((len, i) => {
    const x = cursor
    cursor += len + SEG_GAP
    const map = closed[i]
    return { x, len, decided: map?.progress.completed ?? 0, key: map?.number ?? i }
  })

  return (
    <button type="button" className="proto-card vc-card" onClick={onOpen}>
      <span className="proto-card-name">{project.nameWithOwner}</span>
      <span className="vc-strip-wrap">
        <svg
          width={stripLen}
          height={STRIP_H}
          className="vc-strip"
          role="img"
          aria-label={`${closed.length} closed maps${project.active ? ', travelling' : ', at rest'}`}
        >
          {drawn.map((seg) => (
            <g key={seg.key}>
              <line
                x1={seg.x}
                y1={STRIP_Y}
                x2={seg.x + seg.len}
                y2={STRIP_Y}
                stroke="var(--fg)"
                strokeOpacity="0.55"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {Array.from({ length: seg.decided }, (_, i) => (
                <line
                  // biome-ignore lint/suspicious/noArrayIndexKey: ticks are anonymous marks
                  key={i}
                  x1={seg.x + 4 + i * SEG_PER_DECISION}
                  y1={STRIP_Y - 5}
                  x2={seg.x + 4 + i * SEG_PER_DECISION}
                  y2={STRIP_Y + 5}
                  stroke="var(--fg)"
                  strokeOpacity="0.55"
                  strokeWidth="1.5"
                />
              ))}
            </g>
          ))}
          {project.active ? (
            <>
              <rect
                x={cursor - 4}
                y={STRIP_Y - 6}
                width="12"
                height="12"
                rx="3"
                fill="var(--bg)"
                stroke="var(--fg)"
                strokeWidth="2"
              />
              <rect x={cursor} y={STRIP_Y - 2} width="4" height="4" rx="1" fill="var(--fg)" />
            </>
          ) : (
            <line
              x1={cursor - SEG_GAP + 2}
              y1={STRIP_Y - 6}
              x2={cursor - SEG_GAP + 2}
              y2={STRIP_Y + 6}
              stroke="var(--fg)"
              strokeOpacity="0.55"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}
        </svg>
      </span>
      {project.active ? (
        <span className="proto-card-gist muted">
          {stripInlineMarkdown(project.active.body.destination)}
        </span>
      ) : (
        <span className="proto-card-gist muted">at rest — trace intact</span>
      )}
      <span className="muted small">
        {project.active
          ? `travelling · ${project.active.updatedAt}`
          : `${closed.length} journeys, all closed`}
      </span>
    </button>
  )
}
