import type {
  AutomationAdmission,
  AutomationEvidence,
  AutomationProcessResult,
  ClassificationAttempt,
  SessionReportEvidence,
  Ticket,
  TicketState,
  TicketType,
  WayfinderMap,
  WayfinderSession,
} from '@roadmap/contracts'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import './ticket-node-prototype.css'

/**
 * PROTOTYPE — a game-HUD node and five independent data tags, with no enclosing tint or plate.
 * `?variant=hud|packed|ribbon` changes only the tag lattice. Add `&matrix=1` for full coverage.
 */

type PrototypeVariant = 'hud' | 'packed' | 'ribbon'
type TagTone = 'active' | 'positive' | 'human' | 'warning' | 'failure' | 'unknown'
type TagSlot =
  | 'classification'
  | 'classification-process'
  | 'wayfinder'
  | 'wayfinder-process'
  | 'report'

interface DataTag {
  slot: TagSlot
  stage: 'classification' | 'wayfinder' | 'report'
  glyph: string
  label: string
  word: string
  tone: TagTone
  admission?: AutomationAdmission
}

interface NodeSpec {
  state: TicketState
  isBlocked: boolean
  isClaimed: boolean
  type: TicketType
  tags: DataTag[]
}

interface PrototypeContextValue {
  variant: PrototypeVariant | null
  evidence: AutomationEvidence[]
}

const PrototypeContext = createContext<PrototypeContextValue>({ variant: null, evidence: [] })

const VARIANTS: readonly { key: PrototypeVariant; name: string }[] = [
  { key: 'ribbon', name: 'Tag ribbon' },
  { key: 'hud', name: 'Five-tag HUD' },
  { key: 'packed', name: 'Packed lattice' },
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
        <span className="node-prototype-kicker">HUD node prototype</span>
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
    tags: tagsOf(evidence),
  }

  return <HudNode variant={prototype.variant} spec={spec} x={x} y={y} />
}

function HudNode({
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
  const positions = tagPositions(variant, spec.tags)
  return (
    <g className={`hud-node is-${variant} type-${spec.type} state-${spec.state}`}>
      <MainDiamond spec={spec} x={x} y={y} />
      {positions.map(({ tag, dx, dy }) => (
        <DataDiamond key={tag.slot} tag={tag} x={x + dx} y={y + dy} />
      ))}
    </g>
  )
}

function MainDiamond({ spec, x, y }: { spec: NodeSpec; x: number; y: number }) {
  return (
    <g className="main-diamond">
      <g className="node-shape">
        <path className="node-outer" d={diamondPath(x, y, 12)} />
        <path className="node-inner" d={diamondPath(x, y, 8.5)} />
        {spec.isBlocked && spec.state !== 'blocked' && (
          <path
            className="blocked-corner"
            d={`M ${x - 12} ${y} L ${x} ${y + 12} L ${x - 4} ${y + 8} Z`}
          />
        )}
        {spec.isClaimed && spec.state !== 'claimed' && (
          <path
            className="claimed-corner"
            d={`M ${x} ${y - 12} L ${x + 12} ${y} L ${x + 5} ${y - 7} Z`}
          />
        )}
        <text className="node-glyph" x={x} y={y + 3.5} textAnchor="middle">
          {spec.state === 'closed' ? '✓' : typeGlyph(spec.type)}
        </text>
        <TypeCorners type={spec.type} x={x} y={y} />
      </g>
      <NodeTooltip x={x} y={y - 20} word={stateWord(spec.state)} />
    </g>
  )
}

function TypeCorners({ type, x, y }: { type: TicketType; x: number; y: number }) {
  const count = typeRank(type)
  if (count === 0) return null
  const corners = [
    `M ${x - 8} ${y - 4} L ${x} ${y - 12}`,
    `M ${x + 4} ${y - 8} L ${x + 12} ${y}`,
    `M ${x + 8} ${y + 4} L ${x} ${y + 12}`,
    `M ${x - 4} ${y + 8} L ${x - 12} ${y}`,
  ]
  return (
    <g className="type-corners">
      {corners.slice(0, count).map((path) => (
        <path key={path} d={path} />
      ))}
    </g>
  )
}

function DataDiamond({ tag, x, y }: { tag: DataTag; x: number; y: number }) {
  return (
    <g
      className={`data-diamond slot-${tag.slot} stage-${tag.stage} tone-${tag.tone}${tag.admission === 'override' ? ' is-override' : ''}`}
    >
      <g className="tag-shape">
        <path className="tag-face" d={diamondPath(x, y, 6.5)} />
        <text className="tag-glyph" x={x} y={y + 2.5} textAnchor="middle">
          {tag.glyph}
        </text>
      </g>
      <NodeTooltip x={x} y={y - 13} word={tag.word} />
    </g>
  )
}

function NodeTooltip({ x, y, word }: { x: number; y: number; word: string }) {
  const width = Math.max(26, word.length * 4.4 + 8)
  return (
    <g className="node-tooltip" transform={`translate(${x - width / 2} ${y})`}>
      <rect width={width} height="11" />
      <text x={width / 2} y="7.5" textAnchor="middle">
        {word}
      </text>
    </g>
  )
}

function tagPositions(
  variant: PrototypeVariant,
  tags: DataTag[],
): { tag: DataTag; dx: number; dy: number }[] {
  if (variant === 'ribbon') {
    return tags.map((tag, index) => ({ tag, dx: 19 + index * 14, dy: 0 }))
  }
  if (variant === 'packed') {
    return packedPositions(tags).map(({ tag, dx, dy }) => ({ tag, dx: dx + 18, dy }))
  }
  const fixed: Record<TagSlot, { dx: number; dy: number }> = {
    classification: { dx: 22, dy: -7 },
    'classification-process': { dx: 36, dy: -7 },
    wayfinder: { dx: 15, dy: 7 },
    'wayfinder-process': { dx: 29, dy: 7 },
    report: { dx: 43, dy: 7 },
  }
  return tags.map((tag) => ({ tag, ...fixed[tag.slot] }))
}

function packedPositions(tags: DataTag[]): { tag: DataTag; dx: number; dy: number }[] {
  const layouts: Record<number, { dx: number; dy: number }[]> = {
    0: [],
    1: [{ dx: 0, dy: 0 }],
    2: [
      { dx: 0, dy: -7 },
      { dx: 0, dy: 7 },
    ],
    3: [
      { dx: 0, dy: -7 },
      { dx: 14, dy: 0 },
      { dx: 0, dy: 7 },
    ],
    4: [
      { dx: 0, dy: -7 },
      { dx: 14, dy: -7 },
      { dx: 0, dy: 7 },
      { dx: 14, dy: 7 },
    ],
    5: [
      { dx: 7, dy: -7 },
      { dx: 21, dy: -7 },
      { dx: 0, dy: 7 },
      { dx: 14, dy: 7 },
      { dx: 28, dy: 7 },
    ],
  }
  const layout = layouts[tags.length] ?? []
  return tags.flatMap((tag, index) => {
    const position = layout[index]
    return position === undefined ? [] : [{ tag, ...position }]
  })
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
          Every tracker state follows the completed diamond's double-edged construction. Type
          remains on the node as its rune and 1–4 outer corner strokes.
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
                  tags: [],
                }}
              />
            )),
          ])}
        </div>
      </section>

      <section className="matrix-section">
        <h3>Independent Automation evidence</h3>
        <p>
          Five fixed facts can coexist: Classification, its process result, Wayfinder, its process
          result, and the Session report. Every fact uses the same solid minor-node shape; color and
          one central icon provide its variant.
        </p>
        <table className="automation-matrix">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Tracker overlap</th>
              <th scope="col">Classification</th>
              <th scope="col">Wayfinder</th>
              <th scope="col">Node + tags</th>
            </tr>
          </thead>
          <tbody>
            {AUTOMATION_CASES.map((entry) => (
              <tr key={entry.name}>
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
      <svg viewBox="0 0 112 50" aria-hidden="true">
        <HudNode variant={variant} spec={spec} x={24} y={25} />
      </svg>
    </div>
  )
}

const MATRIX_TYPES: TicketType[] = ['research', 'prototype', 'grilling', 'task', 'untyped']
const MATRIX_STATES: TicketState[] = ['frontier', 'blocked', 'claimed', 'closed']
const AUTO: AutomationAdmission = 'automatic'
const OVERRIDE: AutomationAdmission = 'override'
const TARGET: AutomationEvidence['target'] = {
  project: { integration: 'github', id: 'prototype/matrix' },
  mapId: 'matrix',
  ticketId: 'case',
}

const AUTOMATION_CASES = [
  matrixCase('Ordinary human work', 'frontier', 'task'),
  matrixCase(
    'Classification running',
    'frontier',
    'research',
    evidence({ status: 'running', admission: AUTO }),
  ),
  matrixCase(
    'Human decision required',
    'claimed',
    'grilling',
    evidence({
      status: 'completed',
      admission: OVERRIDE,
      processResult: { status: 'exited', code: 0 },
      verdict: { value: 'hitl', reason: 'Needs a human decision.' },
    }),
  ),
  matrixCase(
    'Unable to classify',
    'blocked',
    'task',
    evidence({
      status: 'completed',
      admission: AUTO,
      processResult: { status: 'exited', code: 0 },
      verdict: { value: 'unable', reason: 'Evidence was insufficient.' },
    }),
  ),
  matrixCase(
    'Classification failed',
    'blocked',
    'prototype',
    evidence({
      status: 'failed',
      admission: AUTO,
      processResult: { status: 'exited', code: 2 },
      reason: 'Classifier failed.',
    }),
  ),
  matrixCase('AFK; handoff pending', 'frontier', 'task', evidence(afkClassification(OVERRIDE))),
  matrixCase(
    'Wayfinder running',
    'claimed',
    'task',
    evidence(afkClassification(AUTO), { status: 'running', admission: AUTO }),
  ),
  matrixCase(
    'Session completed',
    'closed',
    'task',
    evidence(
      afkClassification(AUTO),
      finishedSession({ status: 'exited', code: 0 }, receivedReport('completed')),
    ),
  ),
  matrixCase(
    'Session stopped',
    'frontier',
    'prototype',
    evidence(
      afkClassification(AUTO),
      finishedSession(
        { status: 'signaled', signal: 'SIGTERM' },
        receivedReport('stopped'),
        OVERRIDE,
      ),
    ),
  ),
  matrixCase(
    'Session failed',
    'blocked',
    'task',
    evidence(
      afkClassification(AUTO),
      finishedSession({ status: 'exited', code: 1 }, receivedReport('failed')),
    ),
  ),
  matrixCase(
    'Session report missing',
    'claimed',
    'research',
    evidence(
      afkClassification(AUTO),
      finishedSession(
        { status: 'exited', code: 0 },
        { status: 'missing', reason: 'No terminal report.' },
      ),
    ),
  ),
  matrixCase(
    'Session report invalid',
    'claimed',
    'research',
    evidence(
      afkClassification(AUTO),
      finishedSession(
        { status: 'exited', code: 0 },
        { status: 'invalid', reason: 'Malformed terminal report.' },
      ),
    ),
  ),
  matrixCase(
    'Process result unavailable',
    'claimed',
    'grilling',
    evidence(
      afkClassification(AUTO),
      finishedSession(
        { status: 'unavailable', reason: 'Legacy evidence.' },
        receivedReport('completed'),
      ),
    ),
    true,
    true,
  ),
  matrixCase(
    'Wayfinder outcome unknown',
    'claimed',
    'grilling',
    evidence(afkClassification(AUTO), {
      status: 'outcome-unknown',
      admission: OVERRIDE,
      reason: 'Roadmap restarted.',
    }),
    true,
    true,
  ),
]

function matrixCase(
  name: string,
  state: TicketState,
  type: TicketType,
  automation?: AutomationEvidence,
  isBlocked = state === 'blocked',
  isClaimed = state === 'claimed',
) {
  const tags = tagsOf(automation)
  return {
    name,
    tracker: isBlocked && isClaimed ? 'blocked + claimed' : state,
    classification: tags.find((tag) => tag.slot === 'classification')?.label ?? 'none',
    wayfinder: tags.find((tag) => tag.slot === 'wayfinder')?.label ?? 'none',
    spec: { state, isBlocked, isClaimed, type, tags },
  }
}

function evidence(
  classification: ClassificationAttempt,
  wayfinder?: WayfinderSession,
): AutomationEvidence {
  return { target: TARGET, classification, ...(wayfinder === undefined ? {} : { wayfinder }) }
}

function afkClassification(admission: AutomationAdmission): ClassificationAttempt {
  return {
    status: 'completed',
    admission,
    processResult: { status: 'exited', code: 0 },
    verdict: { value: 'afk', reason: 'Safe for autonomous work.' },
  }
}

function finishedSession(
  processResult: AutomationProcessResult,
  report: SessionReportEvidence,
  admission: AutomationAdmission = AUTO,
): WayfinderSession {
  return { status: 'finished', admission, processResult, report }
}

function receivedReport(
  outcome: 'completed' | 'stopped' | 'failed',
): Extract<SessionReportEvidence, { status: 'received' }> {
  return { status: 'received', report: { outcome, reason: `Session ${outcome}.` } }
}

function evidenceFor(
  map: WayfinderMap,
  ticket: Ticket,
  evidenceList: AutomationEvidence[],
): AutomationEvidence | undefined {
  return evidenceList.find(
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
    classification: afkClassification(OVERRIDE),
    wayfinder:
      ticket.state === 'closed'
        ? finishedSession({ status: 'exited', code: 1 }, receivedReport('failed'))
        : { status: 'running', admission: AUTO },
  }
}

function tagsOf(automation: AutomationEvidence | undefined): DataTag[] {
  if (automation === undefined) return []
  const tags = [classificationTag(automation.classification)]
  const classificationProcess = processOfClassification(automation.classification)
  if (classificationProcess !== undefined) {
    tags.push(processTag('classification-process', 'classification', classificationProcess))
  }
  if (automation.wayfinder !== undefined) {
    tags.push(wayfinderTag(automation.wayfinder))
    if (automation.wayfinder.status === 'finished') {
      tags.push(
        processTag('wayfinder-process', 'wayfinder', automation.wayfinder.processResult),
        reportTag(automation.wayfinder.report),
      )
    }
  }
  return tags
}

function classificationTag(attempt: ClassificationAttempt): DataTag {
  switch (attempt.status) {
    case 'running':
      return tag(
        'classification',
        'classification',
        '…',
        'Classification running',
        'active',
        attempt.admission,
      )
    case 'completed':
      switch (attempt.verdict.value) {
        case 'afk':
          return tag(
            'classification',
            'classification',
            'A',
            'Classification verdict: AFK',
            'positive',
            attempt.admission,
          )
        case 'hitl':
          return tag(
            'classification',
            'classification',
            'H',
            'Classification verdict: HITL',
            'human',
            attempt.admission,
          )
        case 'unable':
          return tag(
            'classification',
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
      return tag(
        'classification',
        'classification',
        '!',
        'Classification failed',
        'failure',
        attempt.admission,
      )
    case 'launch-failed':
      return tag(
        'classification',
        'classification',
        '!',
        'Classification launch failed',
        'failure',
        attempt.admission,
      )
    case 'outcome-unknown':
      return tag(
        'classification',
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

function processOfClassification(
  attempt: ClassificationAttempt,
): AutomationProcessResult | undefined {
  return attempt.status === 'completed' || attempt.status === 'failed'
    ? attempt.processResult
    : undefined
}

function wayfinderTag(session: WayfinderSession): DataTag {
  switch (session.status) {
    case 'launching':
      return tag('wayfinder', 'wayfinder', '↗', 'Wayfinder launching', 'active', session.admission)
    case 'running':
      return tag('wayfinder', 'wayfinder', '▶', 'Wayfinder running', 'active', session.admission)
    case 'finished':
      return tag('wayfinder', 'wayfinder', '◆', 'Wayfinder finished', 'positive', session.admission)
    case 'launch-failed':
      return tag(
        'wayfinder',
        'wayfinder',
        '!',
        'Wayfinder launch failed',
        'failure',
        session.admission,
      )
    case 'outcome-unknown':
      return tag(
        'wayfinder',
        'wayfinder',
        '?',
        'Wayfinder outcome unknown',
        'unknown',
        session.admission,
      )
    default: {
      const _exhaustive: never = session
      return _exhaustive
    }
  }
}

function processTag(
  slot: 'classification-process' | 'wayfinder-process',
  stage: 'classification' | 'wayfinder',
  result: AutomationProcessResult,
): DataTag {
  switch (result.status) {
    case 'exited':
      return result.code === 0
        ? tag(slot, stage, '✓', `${stageLabel(stage)} process exited 0`, 'positive')
        : tag(
            slot,
            stage,
            String(result.code),
            `${stageLabel(stage)} process exited ${result.code}`,
            'failure',
          )
    case 'signaled':
      return tag(
        slot,
        stage,
        '!',
        `${stageLabel(stage)} process ended by ${result.signal}`,
        'failure',
      )
    case 'unavailable':
      return tag(slot, stage, '∅', `${stageLabel(stage)} process result unavailable`, 'unknown')
    default: {
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

function reportTag(report: SessionReportEvidence): DataTag {
  switch (report.status) {
    case 'missing':
      return tag('report', 'report', '∅', 'Session report missing', 'unknown')
    case 'invalid':
      return tag('report', 'report', '!', 'Session report invalid', 'failure')
    case 'received':
      switch (report.report.outcome) {
        case 'completed':
          return tag('report', 'report', '✓', 'Session report: completed', 'positive')
        case 'stopped':
          return tag('report', 'report', '■', 'Session report: stopped', 'warning')
        case 'failed':
          return tag('report', 'report', '!', 'Session report: failed', 'failure')
        default: {
          const _exhaustive: never = report.report.outcome
          return _exhaustive
        }
      }
    default: {
      const _exhaustive: never = report
      return _exhaustive
    }
  }
}

function tag(
  slot: TagSlot,
  stage: DataTag['stage'],
  glyph: string,
  label: string,
  tone: TagTone,
  admission?: AutomationAdmission,
): DataTag {
  return {
    slot,
    stage,
    glyph,
    label,
    word: hoverWord(label),
    tone,
    ...(admission === undefined ? {} : { admission }),
  }
}

function hoverWord(label: string): string {
  if (label.includes('AFK')) return 'AFK'
  if (label.includes('HITL')) return 'HITL'
  if (label.includes('running')) return 'running'
  if (label.includes('launching')) return 'launching'
  if (label.includes('unable')) return 'unable'
  if (label.includes('unknown')) return 'unknown'
  if (label.includes('unavailable')) return 'unavailable'
  if (label.includes('invalid')) return 'invalid'
  if (label.includes('missing')) return 'missing'
  if (label.includes('completed')) return 'completed'
  if (label.includes('stopped')) return 'stopped'
  if (label.includes('failed')) return 'failed'
  if (label.includes('ended by')) return 'signaled'
  if (label.includes('exited')) return 'exited'
  if (label.includes('finished')) return 'finished'
  return 'evidence'
}

function stateWord(state: TicketState): string {
  switch (state) {
    case 'closed':
      return 'decided'
    case 'frontier':
      return 'takeable'
    case 'claimed':
      return 'claimed'
    case 'blocked':
      return 'blocked'
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

function stageLabel(stage: 'classification' | 'wayfinder'): string {
  return stage === 'classification' ? 'Classification' : 'Wayfinder'
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
  const variant = candidate === 'hud' || candidate === 'packed' ? candidate : 'ribbon'
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
  setPrototype(readPrototypeUrl())
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
