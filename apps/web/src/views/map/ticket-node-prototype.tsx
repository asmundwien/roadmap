import type {
  AutomationEvidence,
  ClassificationAttempt,
  Ticket,
  TicketType,
  WayfinderMap,
  WayfinderSession,
} from '@roadmap/contracts'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { STATE_META } from './state-meta.ts'
import './ticket-node-prototype.css'

/**
 * PROTOTYPE — three node-only visual languages on the existing project route, switchable with
 * `?variant=orbit|loadout|aura`. Real Automation evidence wins; tickets without it receive stable
 * demo evidence so dense and overlapping states remain reviewable.
 */

type PrototypeVariant = 'orbit' | 'loadout' | 'aura'

type EffectTone = 'active' | 'positive' | 'human' | 'warning' | 'failure' | 'unknown'

interface StatusEffect {
  stage: 'classification' | 'wayfinder'
  glyph: string
  label: string
  tone: EffectTone
}

interface PrototypeContextValue {
  variant: PrototypeVariant | null
  evidence: AutomationEvidence[]
}

const PrototypeContext = createContext<PrototypeContextValue>({ variant: null, evidence: [] })

const VARIANTS: readonly { key: PrototypeVariant; name: string }[] = [
  { key: 'orbit', name: 'Status orbit' },
  { key: 'loadout', name: 'Effect sockets' },
  { key: 'aura', name: 'Runic aura' },
]

export function TicketNodePrototypeProvider({
  evidence,
  children,
}: {
  evidence: AutomationEvidence[]
  children: ReactNode
}) {
  const [variant, setVariant] = useState<PrototypeVariant>(() => variantFromUrl())

  useEffect(() => {
    const onPopState = () => setVariant(variantFromUrl())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('input, textarea, [contenteditable], [data-nav-item], [data-panel-nav]')) {
        return
      }
      event.preventDefault()
      setVariantAndUrl(variant, event.key === 'ArrowLeft' ? -1 : 1, setVariant)
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [variant])

  const value = useMemo(() => ({ variant, evidence }), [variant, evidence])

  if (import.meta.env.PROD) return children

  return (
    <PrototypeContext.Provider value={value}>
      {children}
      <nav className="node-prototype-switcher" aria-label="Ticket node prototype variants">
        <span className="node-prototype-kicker">Prototype · demo evidence</span>
        <button
          type="button"
          aria-label="Previous ticket node variant"
          onClick={() => setVariantAndUrl(variant, -1, setVariant)}
        >
          ←
        </button>
        <strong>
          {variant.toUpperCase()} — {variantName(variant)}
        </strong>
        <button
          type="button"
          aria-label="Next ticket node variant"
          onClick={() => setVariantAndUrl(variant, 1, setVariant)}
        >
          →
        </button>
      </nav>
    </PrototypeContext.Provider>
  )
}

export function TicketNodePrototypeMark({
  map,
  ticket,
  type,
  x,
  y,
}: {
  map: WayfinderMap
  ticket: Ticket
  type: TicketType
  x: number
  y: number
}) {
  const prototype = useContext(PrototypeContext)
  if (prototype.variant === null) return <BaselineNode ticket={ticket} x={x} y={y} />

  const evidence = evidenceFor(map, ticket, prototype.evidence)
  const effects = effectsOf(evidence ?? demoEvidence(map, ticket))
  const props = { ticket, type, effects, x, y }

  switch (prototype.variant) {
    case 'orbit':
      return <OrbitNode {...props} />
    case 'loadout':
      return <LoadoutNode {...props} />
    case 'aura':
      return <AuraNode {...props} />
    default: {
      const _exhaustive: never = prototype.variant
      return _exhaustive
    }
  }
}

function OrbitNode({ ticket, type, effects, x, y }: NodeVariantProps) {
  return (
    <g className={nodeClasses('orbit', ticket, type)}>
      <StateFrame ticket={ticket} x={x} y={y} />
      <TypeCore type={type} x={x} y={y} />
      {effects.map((effect, index) => {
        const angle = effects.length === 1 ? -35 : -55 + index * 68
        const radians = (angle * Math.PI) / 180
        return (
          <EffectToken
            key={effect.stage}
            effect={effect}
            x={x + Math.cos(radians) * 20}
            y={y + Math.sin(radians) * 20}
            shape="round"
          />
        )
      })}
    </g>
  )
}

function LoadoutNode({ ticket, type, effects, x, y }: NodeVariantProps) {
  return (
    <g className={nodeClasses('loadout', ticket, type)}>
      <rect className="type-tab" x={x - 15} y={y - 10} width="7" height="20" rx="2" />
      <text className="type-tab-glyph" x={x - 11.5} y={y + 3} textAnchor="middle">
        {typeGlyph(type)}
      </text>
      <BaselineNode ticket={ticket} x={x} y={y} />
      {effects.map((effect, index) => (
        <EffectToken
          key={effect.stage}
          effect={effect}
          x={x + 15 + index * 14}
          y={y}
          shape="square"
        />
      ))}
    </g>
  )
}

function AuraNode({ ticket, type, effects, x, y }: NodeVariantProps) {
  return (
    <g className={nodeClasses('aura', ticket, type)}>
      {effects.map((effect, index) => {
        const radius = 14 + index * 5
        return (
          <g key={effect.stage} className={effectClasses(effect)}>
            <title>{effect.label}</title>
            <circle
              className="effect-aura"
              cx={x}
              cy={y}
              r={radius}
              pathLength="100"
              transform={`rotate(${-90 + index * 35} ${x} ${y})`}
            />
            <text
              className="effect-aura-glyph"
              x={x + radius - 1}
              y={y - radius + 4}
              textAnchor="middle"
            >
              {effect.stage === 'classification' ? 'C' : 'W'}
            </text>
          </g>
        )
      })}
      <BaselineNode ticket={ticket} x={x} y={y} />
      <text className="aura-type-glyph" x={x} y={y + 3.5} textAnchor="middle">
        {typeGlyph(type)}
      </text>
      <TypeNotches type={type} x={x} y={y} />
    </g>
  )
}

interface NodeVariantProps {
  ticket: Ticket
  type: TicketType
  effects: StatusEffect[]
  x: number
  y: number
}

function StateFrame({ ticket, x, y }: { ticket: Ticket; x: number; y: number }) {
  const meta = STATE_META[ticket.state]
  if (ticket.state === 'frontier') {
    return (
      <>
        <circle className="state-halo" cx={x} cy={y} r="18" fill={meta.color} />
        <rect
          className="state-frame"
          x={x - 10}
          y={y - 10}
          width="20"
          height="20"
          transform={`rotate(45 ${x} ${y})`}
          fill={meta.color}
        />
      </>
    )
  }
  if (ticket.state === 'claimed') {
    return (
      <>
        <circle className="state-frame" cx={x} cy={y} r="12" stroke={meta.color} />
        <path d={`M ${x} ${y - 12} A 12 12 0 0 0 ${x} ${y + 12} Z`} fill={meta.color} />
      </>
    )
  }
  if (ticket.state === 'blocked') {
    return <circle className="state-frame is-blocked" cx={x} cy={y} r="12" stroke={meta.color} />
  }
  return <circle className="state-frame is-closed" cx={x} cy={y} r="12" fill={meta.color} />
}

function TypeCore({ type, x, y }: { type: TicketType; x: number; y: number }) {
  const glyph = typeGlyph(type)
  if (type === 'research') {
    return (
      <g>
        <path
          className="type-core"
          d={`M ${x} ${y - 8} L ${x + 7} ${y - 4} L ${x + 7} ${y + 4} L ${x} ${y + 8} L ${x - 7} ${y + 4} L ${x - 7} ${y - 4} Z`}
        />
        <text className="type-core-glyph" x={x} y={y + 3} textAnchor="middle">
          {glyph}
        </text>
      </g>
    )
  }
  if (type === 'prototype') {
    return (
      <g>
        <rect className="type-core" x={x - 7} y={y - 7} width="14" height="14" rx="2" />
        <text className="type-core-glyph" x={x} y={y + 3} textAnchor="middle">
          {glyph}
        </text>
      </g>
    )
  }
  if (type === 'grilling') {
    return (
      <g>
        <path
          className="type-core"
          d={`M ${x} ${y - 8} L ${x + 8} ${y + 7} L ${x - 8} ${y + 7} Z`}
        />
        <text className="type-core-glyph" x={x} y={y + 4} textAnchor="middle">
          {glyph}
        </text>
      </g>
    )
  }
  return (
    <g>
      <circle className="type-core" cx={x} cy={y} r="7" />
      <text className="type-core-glyph" x={x} y={y + 3} textAnchor="middle">
        {glyph}
      </text>
    </g>
  )
}

function EffectToken({
  effect,
  x,
  y,
  shape,
}: {
  effect: StatusEffect
  x: number
  y: number
  shape: 'round' | 'square'
}) {
  return (
    <g className={effectClasses(effect)}>
      <title>{effect.label}</title>
      {shape === 'round' ? (
        <circle className="effect-token" cx={x} cy={y} r="6.5" />
      ) : (
        <rect className="effect-token" x={x - 6} y={y - 6} width="12" height="12" rx="2" />
      )}
      <text className="effect-glyph" x={x} y={y + 2.7} textAnchor="middle">
        {effect.glyph}
      </text>
      <text className="effect-stage" x={x + 5.5} y={y - 4.5} textAnchor="middle">
        {effect.stage === 'classification' ? 'C' : 'W'}
      </text>
    </g>
  )
}

function TypeNotches({ type, x, y }: { type: TicketType; x: number; y: number }) {
  const count = type === 'research' ? 1 : type === 'prototype' ? 2 : type === 'grilling' ? 3 : 4
  return (
    <g className="type-notches">
      {Array.from({ length: count }, (_, index) => {
        const dx = (index - (count - 1) / 2) * 4
        return <line key={dx} x1={x + dx} y1={y - 11} x2={x + dx} y2={y - 8} />
      })}
    </g>
  )
}

function BaselineNode({ ticket, x, y }: { ticket: Ticket; x: number; y: number }) {
  const meta = STATE_META[ticket.state]
  if (ticket.state === 'closed') {
    return (
      <>
        <circle cx={x} cy={y} r="10" fill="var(--fg)" />
        <text x={x} y={y + 3.5} textAnchor="middle" className="check">
          ✓
        </text>
      </>
    )
  }
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
  return <circle cx={x} cy={y} r="9" fill="var(--bg)" stroke={meta.color} strokeWidth="2.25" />
}

function evidenceFor(
  map: WayfinderMap,
  ticket: Ticket,
  evidence: AutomationEvidence[],
): AutomationEvidence | undefined {
  return evidence.find(
    (candidate) =>
      candidate.target.project.integration === map.project.integration &&
      candidate.target.project.id === map.project.id &&
      candidate.target.mapId === map.id &&
      candidate.target.ticketId === ticket.id,
  )
}

function demoEvidence(map: WayfinderMap, ticket: Ticket): AutomationEvidence | undefined {
  const slot = stableSlot(ticket.id, 5)
  const target = { project: map.project, mapId: map.id, ticketId: ticket.id }
  if (slot === 0) return undefined
  if (slot === 1) return { target, classification: { status: 'running', admission: 'automatic' } }
  if (slot === 2) {
    return {
      target,
      classification: {
        status: 'completed',
        admission: 'override',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'hitl', reason: 'Needs a human decision.' },
      },
    }
  }
  if (slot === 3) {
    return {
      target,
      classification: {
        status: 'completed',
        admission: 'automatic',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'unable', reason: 'Evidence was insufficient.' },
      },
    }
  }
  return {
    target,
    classification: {
      status: 'completed',
      admission: 'override',
      processResult: { status: 'exited', code: 0 },
      verdict: { value: 'afk', reason: 'Safe for autonomous work.' },
    },
    wayfinder:
      ticket.state === 'closed'
        ? {
            status: 'finished',
            admission: 'automatic',
            processResult: { status: 'exited', code: 1 },
            report: {
              status: 'received',
              report: { outcome: 'failed', reason: 'The session stopped with a reported failure.' },
            },
          }
        : { status: 'running', admission: 'automatic' },
  }
}

function effectsOf(evidence: AutomationEvidence | undefined): StatusEffect[] {
  if (evidence === undefined) return []
  const effects = [classificationEffect(evidence.classification)]
  if (evidence.wayfinder !== undefined) effects.push(wayfinderEffect(evidence.wayfinder))
  return effects
}

function classificationEffect(attempt: ClassificationAttempt): StatusEffect {
  switch (attempt.status) {
    case 'running':
      return effect('classification', '…', 'Classification running', 'active')
    case 'completed':
      switch (attempt.verdict.value) {
        case 'afk':
          return effect('classification', 'A', 'Classification verdict: AFK', 'positive')
        case 'hitl':
          return effect('classification', 'H', 'Classification verdict: HITL', 'human')
        case 'unable':
          return effect('classification', '×', 'Classification verdict: unable', 'warning')
        default: {
          const _exhaustive: never = attempt.verdict.value
          return _exhaustive
        }
      }
    case 'failed':
      return effect('classification', '!', 'Classification failed', 'failure')
    case 'launch-failed':
      return effect('classification', '!', 'Classification launch failed', 'failure')
    case 'outcome-unknown':
      return effect('classification', '?', 'Classification outcome unknown', 'unknown')
    default: {
      const _exhaustive: never = attempt
      return _exhaustive
    }
  }
}

function wayfinderEffect(session: WayfinderSession): StatusEffect {
  switch (session.status) {
    case 'launching':
      return effect('wayfinder', '↗', 'Wayfinder launching', 'active')
    case 'running':
      return effect('wayfinder', '▶', 'Wayfinder running', 'active')
    case 'launch-failed':
      return effect('wayfinder', '!', 'Wayfinder launch failed', 'failure')
    case 'outcome-unknown':
      return effect('wayfinder', '?', 'Wayfinder outcome unknown', 'unknown')
    case 'finished':
      switch (session.report.status) {
        case 'missing':
          return effect('wayfinder', '∅', 'Wayfinder finished; Session report missing', 'unknown')
        case 'invalid':
          return effect('wayfinder', '!', 'Wayfinder finished; Session report invalid', 'failure')
        case 'received':
          switch (session.report.report.outcome) {
            case 'completed':
              return effect('wayfinder', '✓', 'Wayfinder report: completed', 'positive')
            case 'stopped':
              return effect('wayfinder', '■', 'Wayfinder report: stopped', 'warning')
            case 'failed':
              return effect('wayfinder', '!', 'Wayfinder report: failed', 'failure')
            default: {
              const _exhaustive: never = session.report.report.outcome
              return _exhaustive
            }
          }
        default: {
          const _exhaustive: never = session.report
          return _exhaustive
        }
      }
    default: {
      const _exhaustive: never = session
      return _exhaustive
    }
  }
}

function effect(
  stage: StatusEffect['stage'],
  glyph: string,
  label: string,
  tone: EffectTone,
): StatusEffect {
  return { stage, glyph, label, tone }
}

function nodeClasses(variant: PrototypeVariant, ticket: Ticket, type: TicketType): string {
  return `node-prototype is-${variant} is-${type} state-${ticket.state}`
}

function effectClasses(effectValue: StatusEffect): string {
  return `automation-effect is-${effectValue.stage} is-${effectValue.tone}`
}

function typeGlyph(type: TicketType): string {
  switch (type) {
    case 'research':
      return 'R'
    case 'prototype':
      return 'P'
    case 'grilling':
      return 'G'
    case 'task':
      return 'T'
    case 'untyped':
      return '·'
    default: {
      const _exhaustive: never = type
      return _exhaustive
    }
  }
}

function stableSlot(id: string, count: number): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % count
}

function variantFromUrl(): PrototypeVariant {
  const candidate = new URL(window.location.href).searchParams.get('variant')
  if (candidate === 'loadout' || candidate === 'aura') return candidate
  return 'orbit'
}

function setVariantAndUrl(
  current: PrototypeVariant,
  delta: number,
  setVariant: (variant: PrototypeVariant) => void,
) {
  const index = VARIANTS.findIndex((variant) => variant.key === current)
  const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
  if (next === undefined) return
  const url = new URL(window.location.href)
  url.searchParams.set('variant', next.key)
  window.history.replaceState(null, '', url)
  setVariant(next.key)
}

function variantName(variant: PrototypeVariant): string {
  return VARIANTS.find((candidate) => candidate.key === variant)?.name ?? variant
}
