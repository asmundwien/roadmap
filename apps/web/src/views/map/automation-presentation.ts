import type {
  AutomationEvidence,
  AutomationProcessResult,
  ClassificationAttempt,
  SessionReportEvidence,
  Ticket,
  WayfinderMap,
  WayfinderSession,
} from '@roadmap/contracts'

export type AutomationTagSlot =
  | 'classification'
  | 'classification-process'
  | 'wayfinder'
  | 'wayfinder-process'
  | 'report'

export interface AutomationTag {
  slot: AutomationTagSlot
  stage: 'classification' | 'wayfinder'
  glyph: string
  label: string
  word: string
}

export function automationEvidenceFor(
  map: WayfinderMap,
  ticket: Ticket,
  evidence: readonly AutomationEvidence[],
): AutomationEvidence | undefined {
  return evidence.find(
    (candidate) =>
      candidate.target.project.integration === map.project.integration &&
      candidate.target.project.id === map.project.id &&
      candidate.target.mapId === map.id &&
      candidate.target.ticketId === ticket.id,
  )
}

/** The five independent node tags, in their fixed left-to-right order. */
export function automationTags(evidence: AutomationEvidence | undefined): AutomationTag[] {
  if (evidence === undefined) return []
  const tags = [classificationTag(evidence.classification)]
  const classificationProcess = classificationProcessOf(evidence.classification)
  if (classificationProcess !== undefined) {
    tags.push(processTag('classification-process', 'classification', classificationProcess))
  }
  if (evidence.wayfinder !== undefined) {
    tags.push(wayfinderTag(evidence.wayfinder))
    if (evidence.wayfinder.status === 'finished') {
      tags.push(
        processTag('wayfinder-process', 'wayfinder', evidence.wayfinder.processResult),
        reportTag(evidence.wayfinder.report),
      )
    }
  }
  return tags
}

function classificationTag(attempt: ClassificationAttempt): AutomationTag {
  switch (attempt.status) {
    case 'running':
      return tag('classification', 'classification', '…', 'Classification running')
    case 'completed':
      switch (attempt.verdict.value) {
        case 'afk':
          return tag('classification', 'classification', 'A', 'Classification verdict: AFK')
        case 'hitl':
          return tag('classification', 'classification', 'H', 'Classification verdict: HITL')
        case 'unable':
          return tag('classification', 'classification', '×', 'Classification verdict: unable')
        default: {
          const _exhaustive: never = attempt.verdict.value
          return _exhaustive
        }
      }
    case 'failed':
      return tag('classification', 'classification', '!', 'Classification failed')
    case 'launch-failed':
      return tag('classification', 'classification', '!', 'Classification launch failed')
    case 'outcome-unknown':
      return tag('classification', 'classification', '?', 'Classification outcome unknown')
    default: {
      const _exhaustive: never = attempt
      return _exhaustive
    }
  }
}

function classificationProcessOf(
  attempt: ClassificationAttempt,
): AutomationProcessResult | undefined {
  return attempt.status === 'completed' || attempt.status === 'failed'
    ? attempt.processResult
    : undefined
}

function wayfinderTag(session: WayfinderSession): AutomationTag {
  switch (session.status) {
    case 'launching':
      return tag('wayfinder', 'wayfinder', '↗', 'Wayfinder launching')
    case 'running':
      return tag('wayfinder', 'wayfinder', '▶', 'Wayfinder running')
    case 'finished':
      return tag('wayfinder', 'wayfinder', '◆', 'Wayfinder finished')
    case 'launch-failed':
      return tag('wayfinder', 'wayfinder', '!', 'Wayfinder launch failed')
    case 'outcome-unknown':
      return tag('wayfinder', 'wayfinder', '?', 'Wayfinder outcome unknown')
    default: {
      const _exhaustive: never = session
      return _exhaustive
    }
  }
}

function processTag(
  slot: 'classification-process' | 'wayfinder-process',
  stage: AutomationTag['stage'],
  result: AutomationProcessResult,
): AutomationTag {
  const stageLabel = stage === 'classification' ? 'Classification' : 'Wayfinder'
  switch (result.status) {
    case 'exited':
      return result.code === 0
        ? tag(slot, stage, '✓', `${stageLabel} process exited 0`)
        : tag(slot, stage, String(result.code), `${stageLabel} process exited ${result.code}`)
    case 'signaled':
      return tag(slot, stage, '!', `${stageLabel} process ended by ${result.signal}`)
    case 'unavailable':
      return tag(slot, stage, '∅', `${stageLabel} process result unavailable`)
    default: {
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

function reportTag(report: SessionReportEvidence): AutomationTag {
  switch (report.status) {
    case 'missing':
      return tag('report', 'wayfinder', '∅', 'Session report missing')
    case 'invalid':
      return tag('report', 'wayfinder', '!', 'Session report invalid')
    case 'received':
      switch (report.report.outcome) {
        case 'completed':
          return tag('report', 'wayfinder', '✓', 'Session report: completed')
        case 'stopped':
          return tag('report', 'wayfinder', '■', 'Session report: stopped')
        case 'failed':
          return tag('report', 'wayfinder', '!', 'Session report: failed')
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
  slot: AutomationTagSlot,
  stage: AutomationTag['stage'],
  glyph: string,
  label: string,
): AutomationTag {
  return { slot, stage, glyph, label, word: hoverWord(label) }
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
