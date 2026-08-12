import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ticket, TicketState, WayfinderMap } from '../../wayfinder/types.ts'
import { stripInlineMarkdown } from '../gist.ts'
import { buildLedger, type Ledger, type LedgerEdge } from './geometry.ts'
import './map.css'
import { STATE_META } from './state-meta.ts'

/**
 * The unified ledger — the map view the prototype rounds landed on. One left-aligned gutter and
 * text column through three sections (fog, charted ahead, ground covered) with the trunk's rail
 * running through all of them: dashed ahead, solid behind, the transition is HEAD.
 *
 * Two live behaviours the prototype deferred: hovering a row highlights its chain's rail and every
 * edge it touches — the answer to the drill's one HARD question, "what exactly is this waiting
 * on" — and rows whose state just changed under the 30s poll animate in.
 */
export function MapLedger({ map }: { map: WayfinderMap }) {
  const ledger = useMemo(() => buildLedger(map), [map])
  const fresh = useFreshTickets(map)
  const [hover, setHover] = useState<number | null>(null)

  const related = useMemo(() => {
    if (hover === null) return null
    return {
      chainId: ledger.chainIdOf.get(hover) ?? null,
      tickets: new Set([hover, ...(ledger.neighbors.get(hover) ?? [])]),
    }
  }, [hover, ledger])

  const isHotEdge = (edge: LedgerEdge): boolean => {
    if (!related) return false
    if (edge.from === hover || edge.to === hover) return true
    return (
      (edge.kind === 'fork' || edge.kind === 'run') &&
      related.chainId !== null &&
      edge.chainId === related.chainId
    )
  }

  const gistByTitle = new Map(map.body.decisions.map((d) => [d.title, stripInlineMarkdown(d.gist)]))

  return (
    <div className="ledger-wrap">
      <svg
        className={`ledger${hover !== null ? ' has-hover' : ''}`}
        viewBox={`0 0 ${ledger.width} ${ledger.height}`}
        aria-label={`The ledger of ${map.title}: fog, charted ahead, and ground covered, on one rail`}
      >
        <title>{map.title}</title>

        {/* section boundaries — captions live in the text column like every other word */}
        <Section ledger={ledger} y={ledger.sepFog} label="fog · not yet specified" />
        <Section ledger={ledger} y={ledger.sepAhead} label="charted ahead" />
        <Section ledger={ledger} y={ledger.sepBehind} label="ground covered" />

        {/* the trunk's lane, one line through every section: dashed ahead, solid behind */}
        <line
          x1={ledger.gutterX}
          y1={ledger.trunkDashed.y1}
          x2={ledger.gutterX}
          y2={ledger.trunkDashed.y2}
          stroke="var(--muted)"
          strokeWidth="1.75"
          strokeOpacity="0.45"
          strokeDasharray="3 5"
          strokeLinecap="round"
        />
        {ledger.trunkSolid && (
          <line
            x1={ledger.gutterX}
            y1={ledger.trunkSolid.y1}
            x2={ledger.gutterX}
            y2={ledger.trunkSolid.y2}
            stroke="var(--fg)"
            strokeOpacity="0.55"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )}

        {/* the braid: forks off HEAD, straight rails through rows, merges into surviving rails */}
        {ledger.edges.map((edge) => (
          <path
            key={edge.key}
            className={[
              'edge',
              `edge-${edge.kind}`,
              edge.isClaimed ? 'is-claimed' : '',
              isHotEdge(edge) ? 'is-hot' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            d={edge.path}
            fill="none"
            strokeLinecap="round"
          />
        ))}

        {/* ahead rows */}
        {ledger.rows.map(({ ticket, x, y }) => {
          const meta = STATE_META[ticket.state]
          const login = ticket.assignees[0]?.login
          const waits = ticket.blockedBy.filter((b) => b.isOpen)
          const isHot = related?.tickets.has(ticket.number) ?? false
          return (
            <a
              key={ticket.number}
              href={ticket.url}
              className={`row${isHot ? ' is-hot' : ''}${fresh.has(ticket.number) ? ' is-fresh' : ''}`}
              onPointerEnter={() => setHover(ticket.number)}
              onPointerLeave={() => setHover(null)}
            >
              <title>
                {ticket.title}
                {waits.length > 0 ? ` — waits on: ${waits.map((b) => b.title).join(' · ')}` : ''}
              </title>
              <rect
                className="row-hit"
                x="0"
                y={y - 26}
                width={ledger.width}
                height={52}
                fill="transparent"
              />
              {fresh.has(ticket.number) && (
                <circle className="fresh-ping" cx={x} cy={y} r="10" stroke={meta.color} />
              )}
              <StateMarker ticket={ticket} x={x} y={y} />
              <text
                x={ledger.textX}
                y={y + 4}
                className={`row-title${ticket.state === 'blocked' ? ' is-dim' : ''}`}
              >
                {truncate(ticket.title, 46)}
              </text>
              <text x={ledger.textX} y={y + 19} className="row-word" fill={meta.color}>
                {meta.glyph} {meta.word}
                {login !== undefined ? ` · ${login}` : ''}
              </text>
            </a>
          )
        })}

        {/* ground covered — the same grammar, already walked: a check, and what was won */}
        {ledger.closedRows.map(({ ticket, y }) => {
          const gist = gistByTitle.get(ticket.title)
          return (
            <a
              key={ticket.number}
              href={ticket.url}
              className={`row${fresh.has(ticket.number) ? ' is-fresh' : ''}`}
            >
              <title>
                {ticket.title}
                {gist !== undefined ? ` — ${gist}` : ''}
              </title>
              <rect
                className="row-hit"
                x="0"
                y={y - 26}
                width={ledger.width}
                height={52}
                fill="transparent"
              />
              {fresh.has(ticket.number) && (
                <circle
                  className="fresh-ping"
                  cx={ledger.gutterX}
                  cy={y}
                  r="10"
                  stroke="var(--state-closed)"
                />
              )}
              <circle cx={ledger.gutterX} cy={y} r="10" fill="var(--fg)" />
              <text x={ledger.gutterX} y={y + 3.5} textAnchor="middle" className="check">
                ✓
              </text>
              <text x={ledger.textX} y={y + 4} className="behind-title">
                {truncate(ticket.title, 46)}
              </text>
              <text x={ledger.textX} y={y + 19} className="behind-gist">
                {gist !== undefined ? truncate(gist, 76) : 'decided'}
              </text>
            </a>
          )
        })}

        {/* empty sections say so in words — same mechanism everywhere, never a node */}
        {ledger.placeholders.map(({ y, text }) => (
          <text key={y} x={ledger.textX} y={y + 4} className="empty-note">
            {truncate(text, 96)}
          </text>
        ))}

        {/* fog rows — ghost stops: suspected, dim, unconnected, readable */}
        {ledger.fogRows.map(({ item, x, y }) => (
          <g key={item}>
            <title>{item}</title>
            <circle
              cx={x}
              cy={y}
              r="9"
              fill="none"
              stroke="var(--muted)"
              strokeWidth="1.75"
              strokeDasharray="2.5 4"
              strokeOpacity="0.7"
            />
            <text x={ledger.textX} y={y + 4} className="fog-title">
              {truncate(item, 52)}
            </text>
          </g>
        ))}

        {/* the destination — the trunk's final stop, and the one warm thing on the map */}
        <circle
          cx={ledger.gutterX}
          cy={ledger.destY}
          r="18"
          fill="var(--goal)"
          fillOpacity="0.18"
        />
        <text x={ledger.gutterX} y={ledger.destY + 7} textAnchor="middle" className="flag">
          ⚑
        </text>
        <text x={ledger.textX} y={ledger.destTextTop - 14} className="goal-caption">
          the destination
        </text>
        <foreignObject
          x={ledger.textX}
          y={ledger.destTextTop}
          width={ledger.colWidth}
          height={ledger.destLines * ledger.lineHeight + 8}
        >
          <p className="dest" title={ledger.destination}>
            {ledger.destination}
          </p>
        </foreignObject>
      </svg>
    </div>
  )
}

function Section({ ledger, y, label }: { ledger: Ledger; y: number; label: string }) {
  return (
    <>
      <line x1="0" y1={y} x2={ledger.width} y2={y} stroke="var(--edge)" />
      <text x={ledger.textX} y={y + 18} className="caption">
        {label}
      </text>
    </>
  )
}

/** The one 9px node family. `closed` is drawn by the ground-covered section, not here. */
function StateMarker({ ticket, x, y }: { ticket: Ticket; x: number; y: number }) {
  const meta = STATE_META[ticket.state]
  if (ticket.state === 'frontier') {
    return (
      <>
        <circle cx={x} cy={y} r="18" fill={meta.color} fillOpacity="0.16" />
        <rect
          x={x - 8}
          y={y - 8}
          width="16"
          height="16"
          transform={`rotate(45 ${x} ${y})`}
          fill={meta.color}
        />
      </>
    )
  }
  if (ticket.state === 'claimed') {
    return (
      <>
        <circle cx={x} cy={y} r="9" fill="var(--bg)" stroke={meta.color} strokeWidth="2.25" />
        <path d={`M ${x} ${y - 9} A 9 9 0 0 0 ${x} ${y + 9} Z`} fill={meta.color} />
      </>
    )
  }
  if (ticket.state === 'blocked') {
    return <circle cx={x} cy={y} r="9" fill="var(--bg)" stroke={meta.color} strokeWidth="2.25" />
  }
  return null
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

const NO_FRESH: ReadonlySet<number> = new Set()

/**
 * Tickets whose state just changed under the poll — new arrivals count too. The set stays
 * populated a beat longer than the animation so an unrelated re-render can't cut it short.
 */
function useFreshTickets(map: WayfinderMap): ReadonlySet<number> {
  const mapKey = `${map.nameWithOwner}#${map.number}`
  const prevRef = useRef<{ mapKey: string; states: Map<number, TicketState> } | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<number>>(NO_FRESH)

  useEffect(() => {
    const prev = prevRef.current
    const states = new Map(map.tickets.map((t) => [t.number, t.state]))
    prevRef.current = { mapKey, states }
    if (!prev || prev.mapKey !== mapKey) {
      setFresh(NO_FRESH)
      return
    }
    const changed = new Set<number>()
    for (const [number, state] of states) {
      if (prev.states.get(number) !== state) changed.add(number)
    }
    if (changed.size === 0) return
    setFresh(changed)
    const timer = setTimeout(() => setFresh(NO_FRESH), 1600)
    return () => clearTimeout(timer)
  }, [map, mapKey])

  return fresh
}
