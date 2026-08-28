import {
  type Ticket,
  type TicketState,
  type TicketType,
  ticketTypeOf,
  type WayfinderMap,
} from '@roadmap/contracts'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { buildLedger, type Ledger, type LedgerEdge } from './geometry.ts'
import './map.css'
import { type LedgerSelection, scopePlan } from './sequence.ts'
import { STATE_META } from './state-meta.ts'
import { TicketNodePrototypeMark } from './ticket-node-prototype.tsx'

const EXT = 800

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
  trunkToEdge?: boolean
  onSelect: (selection: LedgerSelection) => void
  selected: LedgerSelection | null
  kbNav: boolean
}) {
  const { aggregated, aggLabel, scopeSet, fogMap } = useMemo(() => scopePlan(map), [map])
  const ledger = useMemo(() => buildLedger(fogMap), [fogMap])
  const fresh = useFreshTickets(map)
  const [hover, setHover] = useState<string | null>(null)
  const [focusRow, setFocusRow] = useState<string | null>(null)
  const stateOf = useMemo(
    () => new Map(map.tickets.map((ticket) => [ticket.id, ticket.state])),
    [map],
  )

  const hot = kbNav ? focusRow : hover
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

        <Section ledger={ledger} y={ledger.sepFog} label={fogLabel} />
        {ledger.rows.length > 0 && (
          <Section ledger={ledger} y={ledger.sepAhead} label="charted ahead" />
        )}
        <Section ledger={ledger} y={ledger.sepBehind} label="ground covered" />

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

        {[...ledger.rows].reverse().map(({ ticket, x, y }) => {
          const meta = STATE_META[ticket.state]
          const title = ticketTitle(ticket)
          const assignee = ticket.assignees[0]?.name
          const isHot = related?.tickets.has(ticket.id) ?? false
          const isSelected = selected?.kind === 'ticket' && selected.id === ticket.id
          return (
            <g
              key={ticket.id}
              className={`row${isHot ? ' is-hot' : ''}${fresh.has(ticket.id) ? ' is-fresh' : ''}${isSelected ? ' is-selected' : ''}`}
              onPointerEnter={() => setHover(ticket.id)}
              onPointerLeave={() => setHover(null)}
              {...pressProps(
                () => onSelect({ kind: 'ticket', id: ticket.id }),
                isSelected,
                (focused) => setFocusRow(focused ? ticket.id : null),
              )}
            >
              <rect
                className="row-hit"
                x="0"
                y={y - 26}
                width={ledger.width + EXT}
                height={52}
                fill="transparent"
              />
              {fresh.has(ticket.id) && (
                <circle className="fresh-ping" cx={x} cy={y} r="10" stroke={meta.color} />
              )}
              <TicketNodePrototypeMark
                map={map}
                ticket={ticket}
                type={ticketTypeOf(ticket.typeEvidence)}
                x={x}
                y={y}
              />
              <text
                x={ledger.textX}
                y={y - 4}
                className={`row-title${ticket.state === 'blocked' ? ' is-dim' : ''}`}
              >
                {truncate(title, 46)}
              </text>
              <TypeChip
                type={ticketTypeOf(ticket.typeEvidence)}
                title={truncate(title, 46)}
                titleWeight={600}
                x={ledger.textX}
                baselineY={y - 4}
              />
              <text x={ledger.textX} y={y + 11} className="row-word" fill={meta.color}>
                {meta.glyph} {meta.word}
                {assignee !== undefined ? ` · ${assignee}` : ''}
              </text>
            </g>
          )
        })}

        {ledger.closedRows.map(({ ticket, x, y }) => {
          const title = ticketTitle(ticket)
          const isHot = related?.tickets.has(ticket.id) ?? false
          const isSelected = selected?.kind === 'ticket' && selected.id === ticket.id
          return (
            <g
              key={ticket.id}
              className={`row${isHot ? ' is-hot' : ''}${fresh.has(ticket.id) ? ' is-fresh' : ''}${isSelected ? ' is-selected' : ''}`}
              onPointerEnter={() => setHover(ticket.id)}
              onPointerLeave={() => setHover(null)}
              {...pressProps(
                () => onSelect({ kind: 'ticket', id: ticket.id }),
                isSelected,
                (focused) => setFocusRow(focused ? ticket.id : null),
              )}
            >
              <rect
                className="row-hit"
                x="0"
                y={y - 20}
                width={ledger.width + EXT}
                height={40}
                fill="transparent"
              />
              {fresh.has(ticket.id) && (
                <circle className="fresh-ping" cx={x} cy={y} r="10" stroke="var(--state-closed)" />
              )}
              <TicketNodePrototypeMark
                map={map}
                ticket={ticket}
                type={ticketTypeOf(ticket.typeEvidence)}
                x={x}
                y={y}
              />
              <text x={ledger.textX} y={y + 4} className="behind-title">
                {truncate(title, 46)}
              </text>
              <TypeChip
                type={ticketTypeOf(ticket.typeEvidence)}
                title={truncate(title, 46)}
                titleWeight={500}
                x={ledger.textX}
                baselineY={y + 4}
              />
            </g>
          )
        })}

        {ledger.placeholders.map(({ y, text }) => (
          <text key={y} x={ledger.textX} y={y + 4} className="empty-note">
            {truncate(text, 96)}
          </text>
        ))}

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

function isHotEdge(
  edge: LedgerEdge,
  hot: string | null,
  related: { tickets: Set<string> } | null,
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

function lineageOf(hot: string | null, ledger: Ledger): { tickets: Set<string> } | null {
  if (hot === null) return null
  const tickets = new Set<string>([hot])
  const stack = [hot]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    for (const blocker of ledger.blockersOf.get(id) ?? []) {
      if (!tickets.has(blocker)) {
        tickets.add(blocker)
        stack.push(blocker)
      }
    }
  }
  for (const dependent of ledger.dependentsOf.get(hot) ?? []) tickets.add(dependent)
  return { tickets }
}

function ghostSelected(selected: LedgerSelection | null, sel: LedgerSelection): boolean {
  if (selected === null || selected.kind !== sel.kind) return false
  if (selected.kind === 'fog' && sel.kind === 'fog') return selected.text === sel.text
  if (selected.kind === 'scope' && sel.kind === 'scope') return selected.text === sel.text
  return true
}

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
  x: number
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

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

let measureCtx: CanvasRenderingContext2D | null = null

function textWidth(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 6.5
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

const NO_FRESH: ReadonlySet<string> = new Set()

function useFreshTickets(map: WayfinderMap): ReadonlySet<string> {
  const mapKey = `${map.project.integration}:${map.project.id}#${map.id}`
  const prevRef = useRef<{ mapKey: string; states: Map<string, TicketState> } | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NO_FRESH)

  useEffect(() => {
    const prev = prevRef.current
    const states = new Map(map.tickets.map((ticket) => [ticket.id, ticket.state]))
    prevRef.current = { mapKey, states }
    if (!prev || prev.mapKey !== mapKey) {
      setFresh(NO_FRESH)
      return
    }
    const changed = new Set<string>()
    for (const [id, state] of states) {
      if (prev.states.get(id) !== state) changed.add(id)
    }
    if (changed.size === 0) return
    setFresh(changed)
    const timer = setTimeout(() => setFresh(NO_FRESH), 1600)
    return () => clearTimeout(timer)
  }, [map, mapKey])

  return fresh
}

function ticketTitle(ticket: Ticket): string {
  return ticket.title ?? ticket.displayId ?? ticket.id
}
