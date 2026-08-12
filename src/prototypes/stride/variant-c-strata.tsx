/**
 * PROTOTYPE — throwaway. Variant C: STRATA — the density thesis.
 *
 * The rail is the protagonist: one continuous solid line, and each collapsed map is a stratum
 * whose height is proportional to the ground it covered — one tick across the rail per decision.
 * A long history literally reads heavier. Expired fog is a ghost scatter at the stratum's foot,
 * beside the rail. A secondary open map shows its decided ticks plus hollow ticks still open.
 *
 * The card rotates the same rail horizontal: a journey strip whose segment lengths encode each
 * map's decisions, ending at the head — ring if travelling, cap if at rest. Width encodes history;
 * a long journey overflows and that's data too.
 */

import { stripInlineMarkdown } from '../../views/gist.ts'
import { MapLedger } from '../../views/map/ledger.tsx'
import { SignalMeter } from '../../views/signal-meter.tsx'
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
        <div className="vc-trace">
          {project.maps.map((map) =>
            openMap === map.number ? (
              <OpenStrideC key={map.number} map={map} onToggle={onToggle} />
            ) : (
              <CollapsedStrideC
                key={map.number}
                map={map}
                active={map === project.active}
                onToggle={onToggle}
              />
            ),
          )}
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

function CollapsedStrideC({
  map,
  active,
  onToggle,
}: {
  map: StrideMap
  active: boolean
  onToggle: (n: number) => void
}) {
  const decided = map.progress.completed
  const open = map.progress.total - decided
  const fog = map.body.notYetSpecified
  const ticks = map.isOpen ? decided + open : decided
  const height = Math.max(44, ticks * TICK_PITCH + STRATUM_PAD * 2)

  return (
    <button type="button" className="vc-stride" onClick={() => onToggle(map.number)}>
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
          Array.from({ length: open }, (_, i) => (
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
      <span className="vc-body">
        <span className="vc-title">{map.title}</span>
        <span className="vc-gist muted">{stripInlineMarkdown(map.body.destination)}</span>
        <span className="muted small">
          {map.isOpen
            ? `${decided} decided so far · ${active ? '' : 'live · '}${map.updatedAt}`
            : `${decided} decided · closed ${map.closedAt}`}
          {!map.isOpen && fog.length > 0 && ` · ${fog.length} fog unentered`}
        </span>
        {map.isOpen && (
          <span className="vc-meter">
            <SignalMeter map={map} />
          </span>
        )}
      </span>
    </button>
  )
}

function OpenStrideC({ map, onToggle }: { map: StrideMap; onToggle: (n: number) => void }) {
  return (
    <section className="vc-open">
      <button type="button" className="vc-open-head" onClick={() => onToggle(map.number)}>
        <svg width="110" height="40" aria-hidden="true">
          <line
            x1={RAIL_X}
            y1="0"
            x2={RAIL_X}
            y2="40"
            stroke="var(--fg)"
            strokeOpacity="0.55"
            strokeWidth="2.5"
          />
          <circle cx={RAIL_X} cy="20" r="8" fill="var(--bg)" stroke="var(--fg)" strokeWidth="2.5" />
          <circle cx={RAIL_X} cy="20" r="3" fill="var(--fg)" />
        </svg>
        <span className="vc-body">
          <span className="vc-title">{map.title}</span>
          <span className="muted small">
            #{map.number} · {map.isOpen ? map.updatedAt : `closed ${map.closedAt}`} — click to fold
          </span>
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
              <circle
                cx={cursor + 2}
                cy={STRIP_Y}
                r="6"
                fill="var(--bg)"
                stroke="var(--fg)"
                strokeWidth="2"
              />
              <circle cx={cursor + 2} cy={STRIP_Y} r="2.25" fill="var(--fg)" />
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
