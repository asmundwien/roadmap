import type { Ticket, TicketState, TicketType, WayfinderMap } from '@roadmap/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { stripInlineMarkdown } from '../gist.ts'
import { buildLedger, type Ledger, type LedgerEdge } from './geometry.ts'
import './map.css'
import { STATE_META } from './state-meta.ts'

/**
 * The unified ledger — the map view the prototype rounds landed on. One left-aligned gutter and
 * text column through three sections (fog, charted ahead, ground covered) with the trunk's rail
 * running through all of them: dashed ahead, solid behind, the transition is HEAD.
 *
 * Two live behaviours the prototype deferred: hovering a row lights its dependency lineage — the
 * ticket, everything it waits on transitively, its direct dependents, and exactly the edges
 * between those tickets, nodes and edges always agreeing — the answer to the drill's one HARD
 * question, "what exactly is this waiting on". And rows whose state just changed under the 30s
 * poll animate in.
 */
export function MapLedger({
  map,
  trunkToEdge = false,
}: {
  map: WayfinderMap
  /** Run the solid trunk to the svg's own bottom edge, so the rail continues into whatever the
   * page renders below. The stride accordion passes it for every map except the earliest — one
   * unbroken line from the active destination down to the journey's origin. */
  trunkToEdge?: boolean
}) {
  const ledger = useMemo(() => buildLedger(map), [map])
  const fresh = useFreshTickets(map)
  const [hover, setHover] = useState<number | null>(null)
  const stateOf = useMemo(() => new Map(map.tickets.map((t) => [t.number, t.state])), [map])

  // The hovered ticket, its blockers walked transitively upstream, and its direct dependents.
  const related = useMemo(() => {
    if (hover === null) return null
    const tickets = new Set<number>([hover])
    const stack = [hover]
    for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
      for (const b of ledger.blockersOf.get(n) ?? []) {
        if (!tickets.has(b)) {
          tickets.add(b)
          stack.push(b)
        }
      }
    }
    for (const d of ledger.dependentsOf.get(hover) ?? []) tickets.add(d)
    return { tickets }
  }, [hover, ledger])

  // An edge lights when it touches the hovered ticket itself — scenery included — or when it is
  // a real blocked-by whose both ends are lit, so the highlight follows the graph, not the lanes.
  const isHotEdge = (edge: LedgerEdge): boolean => {
    if (!related) return false
    if (edge.from === hover || edge.to === hover) return true
    return (
      edge.isDependency &&
      edge.from !== null &&
      related.tickets.has(edge.from) &&
      related.tickets.has(edge.to)
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

        {/* section boundaries — captions live in the text column like every other word. A map
            that reached its destination has no fog left to lift: what remains was left out on
            purpose. An empty charted-ahead section is not drawn at all. */}
        <Section
          ledger={ledger}
          y={ledger.sepFog}
          label={map.isOpen ? 'fog · not yet specified' : 'fog · left out of scope'}
        />
        {ledger.rows.length > 0 && (
          <Section ledger={ledger} y={ledger.sepAhead} label="charted ahead" />
        )}
        <Section ledger={ledger} y={ledger.sepBehind} label="ground covered" />

        {/* the trunk's lane: dashed while the destination is ahead — solid once the map closes,
            the whole road reached */}
        <line
          x1={ledger.gutterX}
          y1={ledger.trunkDashed.y1}
          x2={ledger.gutterX}
          y2={ledger.trunkDashed.y2}
          stroke={map.isOpen ? 'var(--muted)' : 'var(--fg)'}
          strokeWidth={map.isOpen ? 1.75 : 2.5}
          strokeOpacity={map.isOpen ? 0.45 : 0.55}
          strokeDasharray={map.isOpen ? '3 5' : undefined}
          strokeLinecap="round"
        />
        {(ledger.trunkSolid || trunkToEdge) && (
          <line
            x1={ledger.gutterX}
            y1={ledger.trunkSolid ? ledger.trunkSolid.y1 : ledger.sepBehind}
            x2={ledger.gutterX}
            y2={trunkToEdge ? ledger.height : (ledger.trunkSolid?.y2 ?? ledger.height)}
            stroke="var(--fg)"
            strokeOpacity="0.55"
            strokeWidth="2.5"
            strokeLinecap={trunkToEdge ? 'butt' : 'round'}
          />
        )}

        {/* the weave: rails, merges, and origin forks — solid into settled work, dashed ahead */}
        {ledger.edges.map((edge) => {
          const target = stateOf.get(edge.to)
          return (
            <path
              key={edge.key}
              className={[
                'edge',
                `edge-${edge.kind}`,
                target === 'closed' ? 'is-settled' : '',
                target === 'claimed' ? 'is-claimed' : '',
                isHotEdge(edge) ? 'is-hot' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              d={edge.path}
              fill="none"
              strokeLinecap="round"
            />
          )
        })}

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
              target="_blank"
              rel="noreferrer"
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
                y={y - 4}
                className={`row-title${ticket.state === 'blocked' ? ' is-dim' : ''}`}
              >
                {truncate(ticket.title, 46)}
              </text>
              <TypeChip
                type={ticket.type}
                title={truncate(ticket.title, 46)}
                titleWeight={600}
                x={ledger.textX}
                y={y}
              />
              <text x={ledger.textX} y={y + 11} className="row-word" fill={meta.color}>
                {meta.glyph} {meta.word}
                {login !== undefined ? ` · ${login}` : ''}
              </text>
            </a>
          )
        })}

        {/* ground covered — the same grammar, already walked: a check on its own rail */}
        {ledger.closedRows.map(({ ticket, x, y }) => {
          const gist = gistByTitle.get(ticket.title)
          const isHot = related?.tickets.has(ticket.number) ?? false
          return (
            <a
              key={ticket.number}
              href={ticket.url}
              target="_blank"
              rel="noreferrer"
              className={`row${isHot ? ' is-hot' : ''}${fresh.has(ticket.number) ? ' is-fresh' : ''}`}
              onPointerEnter={() => setHover(ticket.number)}
              onPointerLeave={() => setHover(null)}
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
                <circle className="fresh-ping" cx={x} cy={y} r="10" stroke="var(--state-closed)" />
              )}
              <circle cx={x} cy={y} r="10" fill="var(--fg)" />
              <text x={x} y={y + 3.5} textAnchor="middle" className="check">
                ✓
              </text>
              <text x={ledger.textX} y={y - 4} className="behind-title">
                {truncate(ticket.title, 46)}
              </text>
              <TypeChip
                type={ticket.type}
                title={truncate(ticket.title, 46)}
                titleWeight={500}
                x={ledger.textX}
                y={y}
              />
              <text x={ledger.textX} y={y + 11} className="behind-gist">
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

/**
 * The kind-of-work layer: the ticket's `wayfinder:<type>` label as a chip after the title —
 * GitHub's label shape in this map's tones (wash fill, edge stroke, muted word). Inline placement
 * needs the title's real width, hence the canvas measurement. An untyped ticket shows nothing
 * rather than a shrug.
 */
function TypeChip({
  type,
  title,
  titleWeight,
  x,
  y,
}: {
  type: TicketType
  title: string
  titleWeight: number
  /** The text column's left edge; the chip rides inline after the title. */
  x: number
  /** The row's center line, same `y` the marker and text lines position from. */
  y: number
}) {
  if (type === 'untyped') return null
  const left = x + textWidth(title, `${titleWeight} 12px ${FONT_STACK}`) + 8
  const label = type.toUpperCase()
  const width = textWidth(label, `600 8.5px ${FONT_STACK}`) + label.length * 0.45 + 12
  return (
    <g className={`type-chip is-${type}`}>
      <rect x={left} y={y - 15.5} width={width} height={14} rx="7" />
      <text x={left + width / 2} y={y - 5.3} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

/** Must mirror the root font-family in index.css, or the measured widths drift from the render. */
const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

let measureCtx: CanvasRenderingContext2D | null = null

/** Rendered width of `text` in viewBox units — the svg's 12px is the canvas's 12px. */
function textWidth(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 6.5
  measureCtx.font = font
  return measureCtx.measureText(text).width
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
