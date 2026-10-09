import type { SourceProjectKey } from '../observation/source.ts'

export type AutomationAdmission = 'automatic' | 'override'
export interface AutomationTarget {
  project: SourceProjectKey
  mapId: string
  ticketId: string
}
export type AutomationOverrideStage = 'classification' | 'wayfinder'
export type AutomationOverrideAvailability =
  | { status: 'eligible' }
  | { status: 'ineligible'; reason: string }
export interface AutomationOverrideControl {
  target: AutomationTarget
  classification: AutomationOverrideAvailability
  wayfinder: AutomationOverrideAvailability
}
export type AutomationProcessResult =
  | { status: 'exited'; code: number }
  | { status: 'signaled'; signal: string }
  | { status: 'unavailable'; reason: string }
export interface ClassificationVerdict {
  value: 'afk' | 'hitl' | 'unable'
  reason: string
}
export type ClassificationAttempt =
  | { status: 'running'; admission: AutomationAdmission }
  | {
      status: 'completed'
      admission: AutomationAdmission
      processResult: AutomationProcessResult
      verdict: ClassificationVerdict
    }
  | {
      status: 'failed'
      admission: AutomationAdmission
      processResult: AutomationProcessResult
      reason: string
    }
  | { status: 'launch-failed'; admission: AutomationAdmission; reason: string }
  | { status: 'outcome-unknown'; admission: AutomationAdmission; reason: string }
export type SessionReportEvidence =
  | { status: 'received'; report: { outcome: 'completed' | 'stopped' | 'failed'; reason: string } }
  | { status: 'missing'; reason: string }
  | { status: 'invalid'; reason: string }
export type WayfinderSession =
  | { status: 'queued' }
  | { status: 'launching'; admission: AutomationAdmission }
  | { status: 'running'; admission: AutomationAdmission }
  | {
      status: 'finished'
      admission: AutomationAdmission
      processResult: AutomationProcessResult
      report: SessionReportEvidence
    }
  | { status: 'launch-failed'; admission: AutomationAdmission; reason: string }
  | {
      status: 'outcome-unknown'
      admission: AutomationAdmission
      reason: string
      acknowledged: boolean
    }
export interface AutomationEvidence {
  target: AutomationTarget
  classification: ClassificationAttempt
  wayfinder?: WayfinderSession
}
