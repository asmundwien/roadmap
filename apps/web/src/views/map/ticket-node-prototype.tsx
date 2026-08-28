import type {
  AutomationAdmission,
  AutomationEvidence,
  ClassificationAttempt,
  Ticket,
  TicketState,
  TicketType,
  WayfinderMap,
  WayfinderSession,
} from '@roadmap/contracts'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import './ticket-node-prototype.css'

/**
 * PROTOTYPE — three angular node arrays on the existing project route, switchable with
 * `?variant=ribbon|stack|field`. Add `&matrix=1` to inspect the complete type, tracker-state, and
 * Automation lifecycle matrix. Real evidence wins on the map; stable demo evidence fills gaps.
 */

type PrototypeVariant = 'ribbon' | 'stack' | 'field'
type EffectTone = 'active' | 'positive' | 'human' | 'warning' | 'failure' | 'unknown'
type PlateTone = 'none' | 'classification' | 'wayfinder'

interface StatusEffect {
  stage: 'classification' | 'wayfinder'
  glyph: string
  label: string
  tone: EffectTone
  admission: AutomationAdmission
}

interface NodeSpec {
  state: TicketState
  isBlocked: boolean
  isClaimed: boolean
  type: TicketType
  effects: StatusEffect[]
}

interface PrototypeContextValue {
  variant: PrototypeVariant | null
  evidence: AutomationEvidence[]
}

const PrototypeContext = createContext<PrototypeContextValue>({ variant: null, evidence: [] })

const VARIANTS: readonly { key: PrototypeVariant; name: string }[] = [
  { key: 'ribbon', name: 'Diamond ribbon' },
  { key: 'stack', name: 'Diamond stack' },
  { key: 'field', name: 'Tinted field' },
]

export function TicketNodePrototypeProvider({
  evidence,
  children,
}: {
  evidence: AutomationEvidence[]
  children: ReactNode
}) {
  const [prototype, setPrototype] = useState(readPrototypeUrl)

  useEffect(() => {
    const onPopState = () => setPrototype(readPrototypeUrl())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('input, textarea, [contenteditable], [data-nav-item], [data-panel-nav]')) {
        return
      }
      event.preventDefault()
      cycleVariant(prototype.variant, event.key === 'ArrowLeft' ? -1 : 1, setPrototype)
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [prototype.variant])

  const value = useMemo(
    () => ({ variant: prototype.variant, evidence }),
    [prototype.variant, evidence],
  )

  if (import.meta.env.PROD) return children

  return (
    <PrototypeContext.Provider value={value}>
      {children}
      {prototype.matrix && (
        <StateMatrix variant={prototype.variant} onClose={() => setMatrix(false, setPrototype)} />
      )}
      <nav className="node-prototype-switcher" aria-label="Ticket node prototype variants">
        <span className="node-prototype-kicker">Angular node prototype</span>
        <button
          type="button"
          aria-label="Previous ticket node variant"
          onClick={() => cycleVariant(prototype.variant, -1, setPrototype)}
        >
          ←
        </button>
        <strong>
          {prototype.variant.toUpperCase()} — {variantName(prototype.variant)}
        </strong>
        <button
          type="button"
          aria-label="Next ticket node variant"
          onClick={() => cycleVariant(prototype.variant, 1, setPrototype)}
        >
          →
        </button>
        <button
          type="button"
          className={prototype.matrix ? 'is-active' : ''}
          aria-pressed={prototype.matrix}
          onClick={() => setMatrix(!prototype.matrix, setPrototype)}
        >
          State matrix
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

  const evidence = evidenceFor(map, ticket, prototype.evidence) ?? demoEvidence(map, ticket)
  const spec: NodeSpec = {
    state: ticket.state,
    isBlocked: ticket.isBlocked,
    isClaimed: ticket.isClaimed,
    type,
    effects: effectsOf(evidence),
  }

  return <AngularNode variant={prototype.variant} spec={spec} x={x} y={y} />
}

function AngularNode({
  variant,
  spec,
  x,
  y,
}: {
  variant: PrototypeVariant
  spec: NodeSpec
  x: number
  y: number
}) {
  const label = nodeLabel(spec)
  return (
    <g className={`angular-node is-${variant} type-${spec.type} state-${spec.state}`}>
      <title>{label}</title>
      {variant === 'ribbon' && <RibbonArray spec={spec} x={x} y={y} />}
      {variant === 'stack' && <StackArray spec={spec} x={x} y={y} />}
      {variant === 'field' && <FieldArray spec={spec} x={x} y={y} />}
    </g>
  )
}

function RibbonArray({ spec, x, y }: { spec: NodeSpec; x: number; y: number }) {
  const width = spec.effects.length === 0 ? 28 : 36 + spec.effects.length * 14
  return (
    <>
      <TintPlate tone={plateTone(spec.effects)} x={x - 14} y={y - 15} width={width} height={30} />
      <MainDiamond spec={spec} x={x} y={y} />
      {spec.effects.map((effect, index) => (
        <EffectDiamond key={effect.stage} effect={effect} x={x + 21 + index * 14} y={y} size={8} />
      ))}
    </>
  )
}

function StackArray({ spec, x, y }: { spec: NodeSpec; x: number; y: number }) {
  const [classification, wayfinder] = spec.effects
  return (
    <>
      <TintPlate
        tone={plateTone(spec.effects)}
        x={x - 14}
        y={y - 19}
        width={spec.effects.length === 0 ? 28 : 48}
        height={38}
      />
      <MainDiamond spec={spec} x={x} y={y} />
      {classification !== undefined && wayfinder === undefined && (
        <EffectDiamond effect={classification} x={x + 21} y={y} size={8} />
      )}
      {classification !== undefined && wayfinder !== undefined && (
        <>
          <EffectDiamond effect={classification} x={x + 21} y={y - 8} size={7} />
          <EffectDiamond effect={wayfinder} x={x + 21} y={y + 8} size={7} />
        </>
      )}
    </>
  )
}

function FieldArray({ spec, x, y }: { spec: NodeSpec; x: number; y: number }) {
  const classification = spec.effects.find((effect) => effect.stage === 'classification')
  const wayfinder = spec.effects.find((effect) => effect.stage === 'wayfinder')
  return (
    <>
      <TintPlate
        tone={classification === undefined ? 'none' : 'classification'}
        detailTone={classification?.tone}
        label={classification?.label}
        x={x - 16}
        y={y - 17}
        width={wayfinder === undefined ? 32 : 50}
        height={34}
      />
      <MainDiamond spec={spec} x={x} y={y} />
      {wayfinder !== undefined && <EffectDiamond effect={wayfinder} x={x + 22} y={y} size={9} />}
    </>
  )
}

function TintPlate({
  tone,
  detailTone,
  label,
  x,
  y,
  width,
  height,
}: {
  tone: PlateTone
  detailTone?: EffectTone
  label?: string
  x: number
  y: number
  width: number
  height: number
}) {
  if (tone === 'none') return null
  const cut = 6
  return (
    <g className={`node-field is-${tone}${detailTone ? ` is-${detailTone}` : ''}`}>
      {label && <title>{label}</title>}
      <path
        d={`M ${x + cut} ${y} H ${x + width - cut} L ${x + width} ${y + cut} V ${y + height - cut} L ${x + width - cut} ${y + height} H ${x + cut} L ${x} ${y + height - cut} V ${y + cut} Z`}
      />
    </g>
  )
}

function MainDiamond({ spec, x, y }: { spec: NodeSpec; x: number; y: number }) {
  return (
    <g className="main-diamond">
      {spec.state === 'frontier' && <path className="frontier-field" d={diamondPath(x, y, 17)} />}
      <path className="diamond-face" d={diamondPath(x, y, 11)} />
      {spec.state === 'claimed' && (
        <path className="claimed-half" d={`M ${x} ${y - 11} L ${x} ${y + 11} L ${x - 11} ${y} Z`} />
      )}
      {spec.isBlocked && spec.state !== 'blocked' && (
        <path
          className="blocked-corner"
          d={`M ${x - 11} ${y} L ${x} ${y + 11} L ${x - 4} ${y + 7} Z`}
        />
      )}
      {spec.isClaimed && spec.state !== 'claimed' && (
        <path
          className="claimed-corner"
          d={`M ${x} ${y - 11} L ${x + 11} ${y} L ${x + 5} ${y - 6} Z`}
        />
      )}
      <text className="type-rune" x={x} y={y + 3.3} textAnchor="middle">
        {spec.state === 'closed' ? '✓' : typeGlyph(spec.type)}
      </text>
      <TypeCorners type={spec.type} x={x} y={y} />
    </g>
  )
}

function TypeCorners({ type, x, y }: { type: TicketType; x: number; y: number }) {
  const count = typeRank(type)
  if (count === 0) return null
  const corners = [
    `M ${x - 7} ${y - 4} L ${x} ${y - 11}`,
    `M ${x + 4} ${y - 7} L ${x + 11} ${y}`,
    `M ${x + 7} ${y + 4} L ${x} ${y + 11}`,
    `M ${x - 4} ${y + 7} L ${x - 11} ${y}`,
  ]
  return (
    <g className="type-corners">
      {corners.slice(0, count).map((path) => (
        <path key={path} d={path} />
      ))}
    </g>
  )
}

function EffectDiamond({
  effect,
  x,
  y,
  size,
}: {
  effect: StatusEffect
  x: number
  y: number
  size: number
}) {
  return (
    <g className={`status-diamond is-${effect.stage} is-${effect.tone}`}>
      <title>{effect.label}</title>
      <path className="status-face" d={diamondPath(x, y, size)} />
      {effect.admission === 'override' && (
        <path
          className="override-corner"
          d={`M ${x} ${y - size} L ${x + size} ${y} L ${x + 4} ${y - size + 4} Z`}
        />
      )}
      <text className="status-glyph" x={x} y={y + 2.7} textAnchor="middle">
        {effect.glyph}
      </text>
      <text className="status-stage" x={x + size - 1} y={y - size + 3} textAnchor="middle">
        {effect.stage === 'classification' ? 'C' : 'W'}
      </text>
    </g>
  )
}

function StateMatrix({ variant, onClose }: { variant: PrototypeVariant; onClose: () => void }) {
  return (
    <section className="node-state-matrix" aria-label="Ticket node state matrix">
      <header>
        <div>
          <p>Prototype coverage</p>
          <h2>{variantName(variant)} state matrix</h2>
        </div>
        <button type="button" onClick={onClose}>
          Back to map
        </button>
      </header>

      <section className="matrix-section">
        <h3>Ticket type × tracker state</h3>
        <p>
          Type lives in the main diamond. Tracker state owns its fill, outline, and corner wedges.
        </p>
        <div className="type-state-matrix">
          <span />
          {MATRIX_STATES.map((state) => (
            <strong key={state}>{state}</strong>
          ))}
          {MATRIX_TYPES.flatMap((type) => [
            <strong key={`${type}-label`}>{type}</strong>,
            ...MATRIX_STATES.map((state) => (
              <MatrixNode
                key={`${type}-${state}`}
                variant={variant}
                label={`${type}, ${state}`}
                spec={{
                  state,
                  isBlocked: state === 'blocked',
                  isClaimed: state === 'claimed',
                  type,
                  effects: [],
                }}
              />
            )),
          ])}
        </div>
      </section>

      <section className="matrix-section">
        <h3>Automation lifecycle × overlap</h3>
        <p>
          The field tint means Automation evidence exists; C and W diamonds carry stage outcomes. A
          cut top-right corner means that stage was admitted by a human override.
        </p>
        <table className="automation-matrix">
          <thead>
            <tr className="matrix-head">
              <th scope="col">Scenario</th>
              <th scope="col">Tracker overlap</th>
              <th scope="col">Classification</th>
              <th scope="col">Wayfinder</th>
              <th scope="col">Node</th>
            </tr>
          </thead>
          <tbody>
            {AUTOMATION_CASES.map((entry) => (
              <tr className="matrix-row" key={entry.name}>
                <th scope="row">{entry.name}</th>
                <td>{entry.tracker}</td>
                <td>{entry.classification}</td>
                <td>{entry.wayfinder}</td>
                <td>
                  <MatrixNode variant={variant} label={entry.name} spec={entry.spec} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  )
}

function MatrixNode({
  variant,
  label,
  spec,
}: {
  variant: PrototypeVariant
  label: string
  spec: NodeSpec
}) {
  return (
    <div className="matrix-node" role="img" aria-label={label}>
      <svg viewBox="0 0 94 50" aria-hidden="true">
        <AngularNode variant={variant} spec={spec} x={28} y={25} />
      </svg>
    </div>
  )
}

const MATRIX_TYPES: TicketType[] = ['research', 'prototype', 'grilling', 'task', 'untyped']
const MATRIX_STATES: TicketState[] = ['frontier', 'blocked', 'claimed', 'closed']

const AUTO: AutomationAdmission = 'automatic'
const OVERRIDE: AutomationAdmission = 'override'

const AUTOMATION_CASES: readonly {
  name: string
  tracker: string
  classification: string
  wayfinder: string
  spec: NodeSpec
}[] = [
  matrixCase('Ordinary human work', 'frontier', false, false, 'task', []),
  matrixCase('Classification running', 'frontier', false, false, 'research', [
    effect('classification', '…', 'Classification running', 'active', AUTO),
  ]),
  matrixCase('Human decision required', 'claimed', false, true, 'grilling', [
    effect('classification', 'H', 'Classification verdict: HITL', 'human', OVERRIDE),
  ]),
  matrixCase('Unable to classify', 'blocked', true, false, 'task', [
    effect('classification', '×', 'Classification verdict: unable', 'warning', AUTO),
  ]),
  matrixCase('Classification failed', 'blocked', true, false, 'prototype', [
    effect('classification', '!', 'Classification failed', 'failure', AUTO),
  ]),
  matrixCase('AFK; handoff pending', 'frontier', false, false, 'task', [
    effect('classification', 'A', 'Classification verdict: AFK', 'positive', OVERRIDE),
  ]),
  matrixCase('Wayfinder running', 'claimed', false, true, 'task', [
    effect('classification', 'A', 'Classification verdict: AFK', 'positive', AUTO),
    effect('wayfinder', '▶', 'Wayfinder running', 'active', AUTO),
  ]),
  matrixCase('Session completed', 'closed', false, false, 'task', [
    effect('classification', 'A', 'Classification verdict: AFK', 'positive', AUTO),
    effect('wayfinder', '✓', 'Wayfinder report: completed', 'positive', AUTO),
  ]),
  matrixCase('Session stopped', 'frontier', false, false, 'prototype', [
    effect('classification', 'A', 'Classification verdict: AFK', 'positive', AUTO),
    effect('wayfinder', '■', 'Wayfinder report: stopped', 'warning', OVERRIDE),
  ]),
  matrixCase('Session failed', 'blocked', true, false, 'task', [
    effect('classification', 'A', 'Classification verdict: AFK', 'positive', AUTO),
    effect('wayfinder', '!', 'Wayfinder report: failed', 'failure', AUTO),
  ]),
  matrixCase('Report missing or invalid', 'claimed', true, true, 'research', [
    effect('classification', 'A', 'Classification verdict: AFK', 'positive', AUTO),
    effect('wayfinder', '∅', 'Wayfinder Session report unavailable', 'unknown', AUTO),
  ]),
  matrixCase('Outcome unknown', 'claimed', true, true, 'grilling', [
    effect('classification', '?', 'Classification outcome unknown', 'unknown', AUTO),
    effect('wayfinder', '?', 'Wayfinder outcome unknown', 'unknown', OVERRIDE),
  ]),
]

function matrixCase(
  name: string,
  state: TicketState,
  isBlocked: boolean,
  isClaimed: boolean,
  type: TicketType,
  effects: StatusEffect[],
) {
  return {
    name,
    tracker: isBlocked && isClaimed ? 'blocked + claimed' : state,
    classification: effects.find((value) => value.stage === 'classification')?.label ?? 'none',
    wayfinder: effects.find((value) => value.stage === 'wayfinder')?.label ?? 'none',
    spec: { state, isBlocked, isClaimed, type, effects },
  }
}

function plateTone(effects: StatusEffect[]): PlateTone {
  if (effects.some((effectValue) => effectValue.stage === 'wayfinder')) return 'wayfinder'
  return effects.length > 0 ? 'classification' : 'none'
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
  if (slot === 1) return { target, classification: { status: 'running', admission: AUTO } }
  if (slot === 2) {
    return {
      target,
      classification: {
        status: 'completed',
        admission: OVERRIDE,
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
        admission: AUTO,
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'unable', reason: 'Evidence was insufficient.' },
      },
    }
  }
  return {
    target,
    classification: {
      status: 'completed',
      admission: OVERRIDE,
      processResult: { status: 'exited', code: 0 },
      verdict: { value: 'afk', reason: 'Safe for autonomous work.' },
    },
    wayfinder:
      ticket.state === 'closed'
        ? {
            status: 'finished',
            admission: AUTO,
            processResult: { status: 'exited', code: 1 },
            report: {
              status: 'received',
              report: { outcome: 'failed', reason: 'The session reported a failure.' },
            },
          }
        : { status: 'running', admission: AUTO },
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
      return effect('classification', '…', 'Classification running', 'active', attempt.admission)
    case 'completed':
      switch (attempt.verdict.value) {
        case 'afk':
          return effect(
            'classification',
            'A',
            'Classification verdict: AFK',
            'positive',
            attempt.admission,
          )
        case 'hitl':
          return effect(
            'classification',
            'H',
            'Classification verdict: HITL',
            'human',
            attempt.admission,
          )
        case 'unable':
          return effect(
            'classification',
            '×',
            'Classification verdict: unable',
            'warning',
            attempt.admission,
          )
        default: {
          const _exhaustive: never = attempt.verdict.value
          return _exhaustive
        }
      }
    case 'failed':
      return effect('classification', '!', 'Classification failed', 'failure', attempt.admission)
    case 'launch-failed':
      return effect(
        'classification',
        '!',
        'Classification launch failed',
        'failure',
        attempt.admission,
      )
    case 'outcome-unknown':
      return effect(
        'classification',
        '?',
        'Classification outcome unknown',
        'unknown',
        attempt.admission,
      )
    default: {
      const _exhaustive: never = attempt
      return _exhaustive
    }
  }
}

function wayfinderEffect(session: WayfinderSession): StatusEffect {
  switch (session.status) {
    case 'launching':
      return effect('wayfinder', '↗', 'Wayfinder launching', 'active', session.admission)
    case 'running':
      return effect('wayfinder', '▶', 'Wayfinder running', 'active', session.admission)
    case 'launch-failed':
      return effect('wayfinder', '!', 'Wayfinder launch failed', 'failure', session.admission)
    case 'outcome-unknown':
      return effect('wayfinder', '?', 'Wayfinder outcome unknown', 'unknown', session.admission)
    case 'finished':
      switch (session.report.status) {
        case 'missing':
          return effect(
            'wayfinder',
            '∅',
            'Wayfinder finished; Session report missing',
            'unknown',
            session.admission,
          )
        case 'invalid':
          return effect(
            'wayfinder',
            '!',
            'Wayfinder finished; Session report invalid',
            'failure',
            session.admission,
          )
        case 'received':
          switch (session.report.report.outcome) {
            case 'completed':
              return effect(
                'wayfinder',
                '✓',
                'Wayfinder report: completed',
                'positive',
                session.admission,
              )
            case 'stopped':
              return effect(
                'wayfinder',
                '■',
                'Wayfinder report: stopped',
                'warning',
                session.admission,
              )
            case 'failed':
              return effect(
                'wayfinder',
                '!',
                'Wayfinder report: failed',
                'failure',
                session.admission,
              )
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
  admission: AutomationAdmission,
): StatusEffect {
  return { stage, glyph, label, tone, admission }
}

function nodeLabel(spec: NodeSpec): string {
  const tracker = spec.isBlocked && spec.isClaimed ? 'blocked and claimed' : spec.state
  const automation =
    spec.effects.length === 0
      ? 'no Automation evidence'
      : spec.effects.map((value) => value.label).join('; ')
  return `${spec.type} ticket; ${tracker}; ${automation}`
}

function diamondPath(x: number, y: number, radius: number): string {
  return `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`
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

function typeRank(type: TicketType): number {
  switch (type) {
    case 'research':
      return 1
    case 'prototype':
      return 2
    case 'grilling':
      return 3
    case 'task':
      return 4
    case 'untyped':
      return 0
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

function readPrototypeUrl(): { variant: PrototypeVariant; matrix: boolean } {
  const url = new URL(window.location.href)
  const candidate = url.searchParams.get('variant')
  const variant = candidate === 'stack' || candidate === 'field' ? candidate : 'ribbon'
  return { variant, matrix: url.searchParams.get('matrix') === '1' }
}

function cycleVariant(
  current: PrototypeVariant,
  delta: number,
  setPrototype: (value: { variant: PrototypeVariant; matrix: boolean }) => void,
) {
  const index = VARIANTS.findIndex((variant) => variant.key === current)
  const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
  if (next === undefined) return
  const url = new URL(window.location.href)
  url.searchParams.set('variant', next.key)
  window.history.replaceState(null, '', url)
  setPrototype({ variant: next.key, matrix: url.searchParams.get('matrix') === '1' })
}

function setMatrix(
  matrix: boolean,
  setPrototype: (value: { variant: PrototypeVariant; matrix: boolean }) => void,
) {
  const url = new URL(window.location.href)
  if (matrix) url.searchParams.set('matrix', '1')
  else url.searchParams.delete('matrix')
  window.history.replaceState(null, '', url)
  const current = readPrototypeUrl()
  setPrototype(current)
}

function variantName(variant: PrototypeVariant): string {
  return VARIANTS.find((candidate) => candidate.key === variant)?.name ?? variant
}

function BaselineNode({ ticket, x, y }: { ticket: Ticket; x: number; y: number }) {
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
  const color = `var(--state-${ticket.state})`
  if (ticket.state === 'frontier') {
    return (
      <>
        <circle cx={x} cy={y} r="18" fill={color} fillOpacity="0.16" />
        <rect
          x={x - 8}
          y={y - 8}
          width="16"
          height="16"
          transform={`rotate(45 ${x} ${y})`}
          fill={color}
        />
      </>
    )
  }
  if (ticket.state === 'claimed') {
    return (
      <>
        <circle cx={x} cy={y} r="9" fill="var(--bg)" stroke={color} strokeWidth="2.25" />
        <path d={`M ${x} ${y - 9} A 9 9 0 0 0 ${x} ${y + 9} Z`} fill={color} />
      </>
    )
  }
  return <circle cx={x} cy={y} r="9" fill="var(--bg)" stroke={color} strokeWidth="2.25" />
}
