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
      return tag(
        'classification',
        'classification',
        '…',
        admitted('Classification running', attempt.admission),
      )
    case 'completed':
      switch (attempt.verdict.value) {
        case 'afk':
          return tag(
            'classification',
            'classification',
            'A',
            admitted('Classification verdict: AFK', attempt.admission),
          )
        case 'hitl':
          return tag(
            'classification',
            'classification',
            'H',
            admitted('Classification verdict: HITL', attempt.admission),
          )
        case 'unable':
          return tag(
            'classification',
            'classification',
            '×',
            admitted('Classification verdict: unable', attempt.admission),
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
        admitted('Classification failed', attempt.admission),
      )
    case 'launch-failed':
      return tag(
        'classification',
        'classification',
        '!',
        admitted('Classification launch failed', attempt.admission),
      )
    case 'outcome-unknown':
      return tag(
        'classification',
        'classification',
        '?',
        admitted('Classification outcome unknown', attempt.admission),
      )
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
    case 'queued':
      return tag('wayfinder', 'wayfinder', '·', 'Wayfinder queued · admission pending')
    case 'launching':
      return tag('wayfinder', 'wayfinder', '↗', admitted('Wayfinder launching', session.admission))
    case 'running':
      return tag('wayfinder', 'wayfinder', '▶', admitted('Wayfinder running', session.admission))
    case 'finished':
      return tag('wayfinder', 'wayfinder', '◆', admitted('Wayfinder finished', session.admission))
    case 'launch-failed':
      return tag(
        'wayfinder',
        'wayfinder',
        '!',
        admitted('Wayfinder launch failed', session.admission),
      )
    case 'outcome-unknown':
      return tag(
        'wayfinder',
        'wayfinder',
        '?',
        `${admitted('Wayfinder outcome unknown', session.admission)} · ${
          session.acknowledged ? 'acknowledged' : 'acknowledgement required'
        }`,
      )
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

function admitted(label: string, admission: 'automatic' | 'override'): string {
  return `${label} · ${admission} admission`
}

function tag(
  slot: AutomationTagSlot,
  stage: AutomationTag['stage'],
  glyph: string,
  label: string,
): AutomationTag {
  return { slot, stage, glyph, label, word: hoverWord(label) }
}

const HOVER_WORDS = [
  ['AFK', 'AFK'],
  ['HITL', 'HITL'],
  ['queued', 'queued'],
  ['running', 'running'],
  ['launching', 'launching'],
  ['unable', 'unable'],
  ['unknown', 'unknown'],
  ['unavailable', 'unavailable'],
  ['invalid', 'invalid'],
  ['missing', 'missing'],
  ['completed', 'completed'],
  ['stopped', 'stopped'],
  ['failed', 'failed'],
  ['ended by', 'signaled'],
  ['exited', 'exited'],
  ['finished', 'finished'],
] as const

function hoverWord(label: string): string {
  for (const [needle, word] of HOVER_WORDS) {
    if (label.includes(needle)) return word
  }
  return 'evidence'
}
