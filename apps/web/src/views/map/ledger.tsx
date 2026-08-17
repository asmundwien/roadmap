import type { Ticket, TicketState, TicketType, WayfinderMap } from '@roadmap/contracts'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { buildLedger, type Ledger, type LedgerEdge } from './geometry.ts'
import './map.css'
import { type LedgerSelection, scopePlan } from './sequence.ts'
import { STATE_META } from './state-meta.ts'

/**
 * The unified ledger — one left-aligned gutter and text column through three sections (fog,
 * charted ahead, ground covered) with the trunk's rail running through all of them: dashed ahead,
 * solid behind, the transition is HEAD.
 *
 * The map renders titles only; every descriptive text lives in the docked Panel. Rows are not
 * GitHub links — clicking one reports a selection upward and the Panel opens it, with "View item
 * in GitHub" inside. Out-of-scope joins the fog band as ⊘ stops, but only inline while the list
 * is small: a vast list collapses to ONE aggregate ⊘ stop carrying the count, so scope can never
 * drown the fog — the Panel holds the full list. Fog and scope stops are clickable too.
 *
 * Two live behaviours: hovering a row lights its dependency lineage — the ticket, everything it
 * waits on transitively, its direct dependents, and exactly the edges between those tickets — and
 * rows whose state just changed under the snapshot feed animate in.
 */

/** Ink overshoot past the viewBox, in svg units: section rules and row bands run right until the
 * layout clips them at the docked Panel's border — no gap between the map's rules and the Panel.
 * Needs `overflow: visible` on the svg (map.css); the map column's own overflow does the
 * clipping at exactly the Panel edge. */
const EXT = 800

/**
 * Click and keyboard activation for an svg row standing in for a button — one member of the
 * screen's single-tab-stop navbar. Roving tabindex: only the selected item is the Tab entry;
 * Space/Enter select; arrows are handled by the screen, which reads these data attributes.
 */
function pressProps(
  select: () => void,
  selected: boolean,
  onFocusChange?: (focused: boolean) => void,
) {
  return {
    role: 'button' as const,
    tabIndex: selected ? 0 : -1,
    'aria-current': selected ? ('true' as const) : undefined,
    'data-nav-item': 'true',
    'data-selected': selected ? 'true' : 'false',
    onClick: select,
    onFocus: onFocusChange ? () => onFocusChange(true) : undefined,
    onBlur: onFocusChange ? () => onFocusChange(false) : undefined,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        select()
      }
    },
  }
}

export function MapLedger({
  map,
  trunkToEdge = false,
  onSelect,
  selected,
  kbNav,
}: {
  map: WayfinderMap
  /** Run the solid trunk to the svg's own bottom edge, so the rail continues into whatever the
   * page renders below. The stride accordion passes it for every map except the earliest — one
   * unbroken line from the active destination down to the journey's origin. */
  trunkToEdge?: boolean
  onSelect: (selection: LedgerSelection) => void
  /** The pick currently in the Panel, when it belongs to this map — drawn as the active band,
   * and re-drawn as the Panel's prev/next move it. */
  selected: LedgerSelection | null
  /** True while the keyboard was the last mover: the focused row then counts as hovered. Any
   * pointer movement flips it off, handing the hover back to the mouse. */
  kbNav: boolean
}) {
  const { aggregated, aggLabel, scopeSet, fogMap } = useMemo(() => scopePlan(map), [map])
  const ledger = useMemo(() => buildLedger(fogMap), [fogMap])
  const fresh = useFreshTickets(map)
  const [hover, setHover] = useState<number | null>(null)
  const [focusRow, setFocusRow] = useState<number | null>(null)
  const stateOf = useMemo(() => new Map(map.tickets.map((t) => [t.number, t.state])), [map])

  // The lineage's source ticket: the ONE hover entity, owned by whichever hand moved last. In
  // pointer mode that is the row under the cursor; in keyboard mode the focused row — the
  // pointer may still rest on its old row, but the entity has moved on.
  const hot = kbNav ? focusRow : hover

  // The hot ticket, its blockers walked transitively upstream, and its direct dependents.
  const related = useMemo(() => lineageOf(hot, ledger), [hot, ledger])

  const fogLabel = fogLabelOf(map)

  return (
    <div className="ledger-wrap">
      <svg
        className={`ledger${hot !== null ? ' has-hover' : ''}`}
        viewBox={`0 0 ${ledger.width} ${ledger.height}`}
        aria-label={`The ledger of ${map.title}: fog, charted ahead, and ground covered, on one rail`}
      >
        <title>{map.title}</title>

        {/* section boundaries — captions live in the text column like every other word. A map
            that reached its destination has no fog left to lift: what remains was left out on
            purpose. An empty charted-ahead section is not drawn at all. */}
        <Section ledger={ledger} y={ledger.sepFog} label={fogLabel} />
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
                isHotEdge(edge, hot, related) ? 'is-hot' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              d={edge.path}
              fill="none"
              strokeLinecap="round"
            />
          )
        })}

        {/* fog rows — ghost stops, clickable: the Panel holds each one's full text. A small
            out-of-scope list rides inline as ⊘ stops; a vast one is the single aggregate stop. */}
        {ledger.fogRows.map(({ item, x, y }) => {
          const sel: LedgerSelection =
            aggregated && item === aggLabel
              ? { kind: 'scope-all' }
              : scopeSet.has(item)
                ? { kind: 'scope', text: item }
                : { kind: 'fog', text: item }
          const isSelected = ghostSelected(selected, sel)
          const tip =
            sel.kind === 'scope-all'
              ? 'left out of scope — the full list opens in the panel'
              : sel.kind === 'scope'
                ? `left out of scope — ${item}`
                : item
          return (
            <g
              key={item}
              className={`ghost-row${isSelected ? ' is-selected' : ''}`}
              {...pressProps(() => onSelect(sel), isSelected)}
            >
              <title>{tip}</title>
              <rect
                className="row-hit"
                x="0"
                y={y - 20}
                width={ledger.width + EXT}
                height={40}
                fill="transparent"
              />
              <GhostMark kind={sel.kind} x={x} y={y} />
              <text
                x={ledger.textX}
                y={y + 4}
                className={`fog-title${sel.kind === 'scope' ? ' scope-title' : ''}`}
              >
                {truncate(item, 52)}
              </text>
            </g>
          )
        })}

        {/* ahead rows — the title and the state word; everything else waits in the Panel.
            Reversed: the array is takeable-first (bottom-up), the DOM must read top-down so the
            keyboard's roving hover walks the picture in order. */}
        {[...ledger.rows].reverse().map(({ ticket, x, y }) => {
          const meta = STATE_META[ticket.state]
          const login = ticket.assignees[0]?.login
          const waits = ticket.blockedBy.filter((b) => b.isOpen)
          const isHot = related?.tickets.has(ticket.number) ?? false
          const isSelected = selected?.kind === 'ticket' && selected.number === ticket.number
          return (
            <g
              key={ticket.number}
              className={`row${isHot ? ' is-hot' : ''}${fresh.has(ticket.number) ? ' is-fresh' : ''}${isSelected ? ' is-selected' : ''}`}
              onPointerEnter={() => setHover(ticket.number)}
              onPointerLeave={() => setHover(null)}
              {...pressProps(
                () => onSelect({ kind: 'ticket', number: ticket.number }),
                isSelected,
                (focused) => setFocusRow(focused ? ticket.number : null),
              )}
            >
              <title>
                {ticket.title}
                {waits.length > 0 ? ` — waits on: ${waits.map((b) => b.title).join(' · ')}` : ''}
              </title>
              <rect
                className="row-hit"
                x="0"
                y={y - 26}
                width={ledger.width + EXT}
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
                baselineY={y - 4}
              />
              <text x={ledger.textX} y={y + 11} className="row-word" fill={meta.color}>
                {meta.glyph} {meta.word}
                {login !== undefined ? ` · ${login}` : ''}
              </text>
            </g>
          )
        })}

        {/* ground covered — title only, one line; the decision's gist lives in the Panel */}
        {ledger.closedRows.map(({ ticket, x, y }) => {
          const isHot = related?.tickets.has(ticket.number) ?? false
          const isSelected = selected?.kind === 'ticket' && selected.number === ticket.number
          return (
            <g
              key={ticket.number}
              className={`row${isHot ? ' is-hot' : ''}${fresh.has(ticket.number) ? ' is-fresh' : ''}${isSelected ? ' is-selected' : ''}`}
              onPointerEnter={() => setHover(ticket.number)}
              onPointerLeave={() => setHover(null)}
              {...pressProps(
                () => onSelect({ kind: 'ticket', number: ticket.number }),
                isSelected,
                (focused) => setFocusRow(focused ? ticket.number : null),
              )}
            >
              <title>{ticket.title}</title>
              <rect
                className="row-hit"
                x="0"
                y={y - 20}
                width={ledger.width + EXT}
                height={40}
                fill="transparent"
              />
              {fresh.has(ticket.number) && (
                <circle className="fresh-ping" cx={x} cy={y} r="10" stroke="var(--state-closed)" />
              )}
              <circle cx={x} cy={y} r="10" fill="var(--fg)" />
              <text x={x} y={y + 3.5} textAnchor="middle" className="check">
                ✓
              </text>
              <text x={ledger.textX} y={y + 4} className="behind-title">
                {truncate(ticket.title, 46)}
              </text>
              <TypeChip
                type={ticket.type}
                title={truncate(ticket.title, 46)}
                titleWeight={500}
                x={ledger.textX}
                baselineY={y + 4}
              />
            </g>
          )
        })}

        {/* empty sections say so in words — same mechanism everywhere, never a node */}
        {ledger.placeholders.map(({ y, text }) => (
          <text key={y} x={ledger.textX} y={y + 4} className="empty-note">
            {truncate(text, 96)}
          </text>
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

/**
 * An edge lights when it touches the hot ticket itself — scenery included — or when it is a real
 * blocked-by whose both ends are lit, so the highlight follows the graph, not the lanes.
 */
function isHotEdge(
  edge: LedgerEdge,
  hot: number | null,
  related: { tickets: Set<number> } | null,
): boolean {
  if (!related) return false
  if (edge.from === hot || edge.to === hot) return true
  return (
    edge.isDependency &&
    edge.from !== null &&
    related.tickets.has(edge.from) &&
    related.tickets.has(edge.to)
  )
}

function fogLabelOf(map: WayfinderMap): string {
  if (!map.isOpen) return 'fog · left out of scope'
  return map.body.outOfScope.length > 0
    ? 'fog · not yet specified · ⊘ out of scope'
    : 'fog · not yet specified'
}

/** The hot ticket's lineage: itself, its blockers walked transitively, its direct dependents. */
function lineageOf(hot: number | null, ledger: Ledger): { tickets: Set<number> } | null {
  if (hot === null) return null
  const tickets = new Set<number>([hot])
  const stack = [hot]
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    for (const b of ledger.blockersOf.get(n) ?? []) {
      if (!tickets.has(b)) {
        tickets.add(b)
        stack.push(b)
      }
    }
  }
  for (const d of ledger.dependentsOf.get(hot) ?? []) tickets.add(d)
  return { tickets }
}

/** Whether the Panel's pick is this ghost stop. */
function ghostSelected(selected: LedgerSelection | null, sel: LedgerSelection): boolean {
  if (selected === null || selected.kind !== sel.kind) return false
  if (selected.kind === 'fog' && sel.kind === 'fog') return selected.text === sel.text
  if (selected.kind === 'scope' && sel.kind === 'scope') return selected.text === sel.text
  return true
}

/** The three ghost-stop marks: dashed maybe-someday, struck ⊘, and the stacked aggregate ⊘. */
function GhostMark({ kind, x, y }: { kind: LedgerSelection['kind']; x: number; y: number }) {
  if (kind === 'fog') {
    return (
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
    )
  }
  return (
    <>
      {kind === 'scope-all' && (
        <circle
          cx={x + 6}
          cy={y - 5}
          r="9"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="1.5"
          strokeOpacity="0.3"
        />
      )}
      <circle
        cx={x}
        cy={y}
        r="9"
        fill={kind === 'scope-all' ? 'var(--bg)' : 'none'}
        stroke="var(--muted)"
        strokeWidth="1.75"
        strokeOpacity="0.55"
      />
      <line
        x1={x - 6.4}
        y1={y + 6.4}
        x2={x + 6.4}
        y2={y - 6.4}
        stroke="var(--muted)"
        strokeWidth="1.75"
        strokeOpacity="0.55"
      />
    </>
  )
}

function Section({ ledger, y, label }: { ledger: Ledger; y: number; label: string }) {
  return (
    <>
      <line x1="0" y1={y} x2={ledger.width + EXT} y2={y} stroke="var(--edge)" />
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
 * rather than a shrug. Positioned off the title's baseline, so it rides one-line and two-line
 * rows alike.
 */
function TypeChip({
  type,
  title,
  titleWeight,
  x,
  baselineY,
}: {
  type: TicketType
  title: string
  titleWeight: number
  /** The text column's left edge; the chip rides inline after the title. */
  x: number
  /** The title's text baseline — the chip aligns to the line, wherever the row centers it. */
  baselineY: number
}) {
  if (type === 'untyped') return null
  const left = x + textWidth(title, `${titleWeight} 12px ${FONT_STACK}`) + 8
  const label = type.toUpperCase()
  const width = textWidth(label, `600 8.5px ${FONT_STACK}`) + label.length * 0.45 + 12
  return (
    <g className={`type-chip is-${type}`}>
      <rect x={left} y={baselineY - 11.5} width={width} height={14} rx="7" />
      <text x={left + width / 2} y={baselineY - 1.3} textAnchor="middle">
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
 * Tickets whose state just changed under the snapshot feed — new arrivals count too. The set
 * stays populated a beat longer than the animation so an unrelated re-render can't cut it short.
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
