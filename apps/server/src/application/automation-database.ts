import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  AutomationAdmission,
  AutomationEvidence,
  AutomationProcessResult,
  AutomationTarget,
  ClassificationAttempt,
  ClassificationVerdict,
  ProjectKey,
  SessionReportEvidence,
  WayfinderSession,
} from '@roadmap/contracts'
import { isRecord } from '../type-guards.ts'

interface AutomationEventIdentity {
  readonly id: string
  readonly opportunityId: string
  readonly recordedAt: string
}

export interface AutomationOpportunity {
  readonly id: string
  readonly target: AutomationTarget
}

export type AutomationEvent =
  | (AutomationEventIdentity & {
      readonly type: 'classification-started'
      readonly admission: AutomationAdmission
    })
  | (AutomationEventIdentity & {
      readonly type: 'classification-completed'
      readonly processResult: AutomationProcessResult
      readonly verdict: ClassificationVerdict
    })
  | (AutomationEventIdentity & {
      readonly type: 'classification-failed'
      readonly processResult: AutomationProcessResult
      readonly reason: string
    })
  | (AutomationEventIdentity & {
      readonly type: 'classification-launch-failed'
      readonly reason: string
    })
  | (AutomationEventIdentity & {
      readonly type: 'classification-outcome-unknown'
      readonly reason: string
    })
  | (AutomationEventIdentity & {
      readonly type: 'wayfinder-launching'
      readonly admission: AutomationAdmission
    })
  | (AutomationEventIdentity & { readonly type: 'wayfinder-running' })
  | (AutomationEventIdentity & {
      readonly type: 'wayfinder-finished'
      readonly processResult: AutomationProcessResult
      readonly report: SessionReportEvidence
    })
  | (AutomationEventIdentity & {
      readonly type: 'wayfinder-launch-failed'
      readonly reason: string
    })
  | (AutomationEventIdentity & {
      readonly type: 'wayfinder-outcome-unknown'
      readonly reason: string
    })
  | (AutomationEventIdentity & {
      readonly type: 'wayfinder-outcome-unknown-acknowledged'
      readonly unknownEventId: string
    })

export interface AutomationDatabase {
  readonly schemaVersion: 3
  readonly opportunities: readonly AutomationOpportunity[]
  readonly events: readonly AutomationEvent[]
}

export interface AutomationAppend {
  readonly opportunities?: readonly AutomationOpportunity[]
  readonly events: readonly AutomationEvent[]
}

export type ProjectedWayfinderSession =
  | { readonly status: 'queued' }
  | { readonly status: 'launching'; readonly admission: AutomationAdmission }
  | { readonly status: 'running'; readonly admission: AutomationAdmission }
  | {
      readonly status: 'finished'
      readonly admission: AutomationAdmission
      readonly processResult: AutomationProcessResult
      readonly report: SessionReportEvidence
    }
  | {
      readonly status: 'launch-failed'
      readonly admission: AutomationAdmission
      readonly reason: string
    }
  | {
      readonly status: 'outcome-unknown'
      readonly admission: AutomationAdmission
      readonly reason: string
      readonly eventId: string
      readonly acknowledged: boolean
    }

export interface AutomationRecord {
  readonly opportunity: AutomationOpportunity
  readonly classification: ClassificationAttempt
  readonly wayfinder?: ProjectedWayfinderSession
}

export interface AutomationProjection {
  readonly records: readonly AutomationRecord[]
  readonly evidence: readonly AutomationEvidence[]
}

export interface AutomationDatabaseDocument {
  load(): Promise<AutomationDatabase>
  append(batch: AutomationAppend): Promise<AutomationDatabase>
}

interface MutableAutomationRecord {
  readonly opportunity: AutomationOpportunity
  classification?: ClassificationAttempt
  wayfinder?: ProjectedWayfinderSession
}

const EMPTY_DATABASE: AutomationDatabase = {
  schemaVersion: 3,
  opportunities: [],
  events: [],
}

export function createAutomationDatabaseDocument(path: string): AutomationDatabaseDocument {
  let current: AutomationDatabase | null = null
  return {
    async load() {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (error) {
        if (isMissing(error)) {
          current = EMPTY_DATABASE
          return current
        }
        throw new Error('The Automation database could not be read.')
      }
      let input: unknown
      try {
        input = JSON.parse(raw)
      } catch {
        throw new Error('The Automation database contains invalid JSON.')
      }
      current = decodeAutomationDatabase(input)
      return current
    },
    async append(batch) {
      if (!current) throw new Error('The Automation database must be loaded before appending.')
      const next = appendAutomationDatabase(current, batch)
      await atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`)
      current = next
      return next
    },
  }
}

export function appendAutomationDatabase(
  database: AutomationDatabase,
  batch: AutomationAppend,
): AutomationDatabase {
  const opportunities = batch.opportunities ?? []
  if (opportunities.length === 0 && batch.events.length === 0) {
    throw new Error('An Automation database append must contain a durable fact.')
  }
  return validateAutomationDatabase({
    schemaVersion: 3,
    opportunities: [...database.opportunities, ...opportunities],
    events: [...database.events, ...batch.events],
  })
}

export function decodeAutomationDatabase(input: unknown): AutomationDatabase {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['schemaVersion', 'opportunities', 'events']) ||
    input.schemaVersion !== 3 ||
    !Array.isArray(input.opportunities) ||
    !Array.isArray(input.events)
  ) {
    throw new Error('The Automation database has an unsupported shape.')
  }
  return validateAutomationDatabase({
    schemaVersion: 3,
    opportunities: input.opportunities.map(decodeOpportunity),
    events: input.events.map(decodeEvent),
  })
}

function validateAutomationDatabase(database: AutomationDatabase): AutomationDatabase {
  replayAutomationDatabase(database)
  return database
}

export function replayAutomationDatabase(database: AutomationDatabase): AutomationProjection {
  const byId = new Map<string, MutableAutomationRecord>()
  const targetIds = new Set<string>()
  for (const opportunity of database.opportunities) {
    if (byId.has(opportunity.id)) {
      throw new Error('The Automation database repeats an opportunity identity.')
    }
    const key = automationTargetKey(opportunity.target)
    if (targetIds.has(key)) {
      throw new Error('The Automation database repeats an Automation target.')
    }
    byId.set(opportunity.id, { opportunity })
    targetIds.add(key)
  }

  const eventIds = new Set<string>()
  for (const event of database.events) {
    if (eventIds.has(event.id))
      throw new Error('The Automation database repeats an event identity.')
    eventIds.add(event.id)
    const record = byId.get(event.opportunityId)
    if (!record) throw new Error('An Automation event references an unknown opportunity.')
    applyEvent(record, event)
  }

  const records: AutomationRecord[] = []
  for (const record of byId.values()) {
    if (!record.classification) {
      throw new Error('An Automation opportunity has no Classification start event.')
    }
    records.push({
      opportunity: record.opportunity,
      classification: record.classification,
      ...(record.wayfinder ? { wayfinder: record.wayfinder } : {}),
    })
  }
  return { records, evidence: records.map(evidenceOf) }
}

function applyEvent(record: MutableAutomationRecord, event: AutomationEvent): void {
  switch (event.type) {
    case 'classification-started':
      if (record.classification) invalidTransition(event)
      record.classification = { status: 'running', admission: event.admission }
      return
    case 'classification-completed': {
      const admission = runningClassificationAdmission(record, event)
      record.classification = {
        status: 'completed',
        admission,
        processResult: event.processResult,
        verdict: event.verdict,
      }
      if (event.verdict.value === 'afk') record.wayfinder = { status: 'queued' }
      return
    }
    case 'classification-failed': {
      const admission = runningClassificationAdmission(record, event)
      record.classification = {
        status: 'failed',
        admission,
        processResult: event.processResult,
        reason: event.reason,
      }
      return
    }
    case 'classification-launch-failed': {
      const admission = runningClassificationAdmission(record, event)
      record.classification = { status: 'launch-failed', admission, reason: event.reason }
      return
    }
    case 'classification-outcome-unknown': {
      const admission = runningClassificationAdmission(record, event)
      record.classification = { status: 'outcome-unknown', admission, reason: event.reason }
      return
    }
    case 'wayfinder-launching':
      if (
        record.classification?.status !== 'completed' ||
        record.classification.verdict.value !== 'afk' ||
        record.wayfinder?.status !== 'queued'
      ) {
        invalidTransition(event)
      }
      record.wayfinder = { status: 'launching', admission: event.admission }
      return
    case 'wayfinder-running': {
      const admission = launchingWayfinderAdmission(record, event)
      record.wayfinder = { status: 'running', admission }
      return
    }
    case 'wayfinder-finished': {
      const admission = activeWayfinderAdmission(record, event)
      record.wayfinder = {
        status: 'finished',
        admission,
        processResult: event.processResult,
        report: event.report,
      }
      return
    }
    case 'wayfinder-launch-failed': {
      const admission = launchingWayfinderAdmission(record, event)
      record.wayfinder = { status: 'launch-failed', admission, reason: event.reason }
      return
    }
    case 'wayfinder-outcome-unknown': {
      const admission = activeWayfinderAdmission(record, event)
      record.wayfinder = {
        status: 'outcome-unknown',
        admission,
        reason: event.reason,
        eventId: event.id,
        acknowledged: false,
      }
      return
    }
    case 'wayfinder-outcome-unknown-acknowledged': {
      const wayfinder = record.wayfinder
      if (
        wayfinder?.status !== 'outcome-unknown' ||
        wayfinder.eventId !== event.unknownEventId ||
        wayfinder.acknowledged
      ) {
        invalidTransition(event)
      }
      record.wayfinder = { ...wayfinder, acknowledged: true }
      return
    }
    default: {
      const _exhaustive: never = event
      throw new Error(`Unsupported Automation event: ${String(_exhaustive)}`)
    }
  }
}

function runningClassificationAdmission(
  record: MutableAutomationRecord,
  event: AutomationEvent,
): AutomationAdmission {
  if (record.classification?.status !== 'running') invalidTransition(event)
  return record.classification.admission
}

function launchingWayfinderAdmission(
  record: MutableAutomationRecord,
  event: AutomationEvent,
): AutomationAdmission {
  if (record.wayfinder?.status !== 'launching') invalidTransition(event)
  return record.wayfinder.admission
}

function activeWayfinderAdmission(
  record: MutableAutomationRecord,
  event: AutomationEvent,
): AutomationAdmission {
  if (record.wayfinder?.status !== 'launching' && record.wayfinder?.status !== 'running') {
    invalidTransition(event)
  }
  return record.wayfinder.admission
}

function invalidTransition(event: AutomationEvent): never {
  throw new Error(
    `Automation event ${event.id} (${event.type}) is invalid at this point in history.`,
  )
}

function evidenceOf(record: AutomationRecord): AutomationEvidence {
  const wayfinder = publicWayfinder(record.wayfinder)
  return {
    target: record.opportunity.target,
    classification: record.classification,
    ...(wayfinder ? { wayfinder } : {}),
  }
}

function publicWayfinder(
  wayfinder: ProjectedWayfinderSession | undefined,
): WayfinderSession | undefined {
  if (!wayfinder) return undefined
  if (wayfinder.status === 'outcome-unknown') {
    return {
      status: 'outcome-unknown',
      admission: wayfinder.admission,
      reason: wayfinder.reason,
      acknowledged: wayfinder.acknowledged,
    }
  }
  return wayfinder
}

function decodeOpportunity(input: unknown): AutomationOpportunity {
  if (!isRecord(input) || !exactKeys(input, ['id', 'target'])) {
    throw new Error('An Automation opportunity has an unsupported shape.')
  }
  return { id: requiredString(input.id), target: decodeTarget(input.target) }
}

function decodeEvent(input: unknown): AutomationEvent {
  if (!isRecord(input) || typeof input.type !== 'string') {
    throw new Error('An Automation event has an unsupported shape.')
  }
  const identity = {
    id: requiredString(input.id),
    opportunityId: requiredString(input.opportunityId),
    recordedAt: decodeRecordedAt(input.recordedAt),
  }
  switch (input.type) {
    case 'classification-started':
      requireEventKeys(input, ['admission'])
      return { ...identity, type: input.type, admission: decodeAdmission(input.admission) }
    case 'classification-completed':
      requireEventKeys(input, ['processResult', 'verdict'])
      return {
        ...identity,
        type: input.type,
        processResult: decodeProcessResult(input.processResult),
        verdict: decodeClassificationVerdict(input.verdict),
      }
    case 'classification-failed':
      requireEventKeys(input, ['processResult', 'reason'])
      return {
        ...identity,
        type: input.type,
        processResult: decodeProcessResult(input.processResult),
        reason: limitedReason(input.reason),
      }
    case 'classification-launch-failed':
    case 'classification-outcome-unknown':
    case 'wayfinder-launch-failed':
    case 'wayfinder-outcome-unknown':
      requireEventKeys(input, ['reason'])
      return { ...identity, type: input.type, reason: limitedReason(input.reason) }
    case 'wayfinder-launching':
      requireEventKeys(input, ['admission'])
      return { ...identity, type: input.type, admission: decodeAdmission(input.admission) }
    case 'wayfinder-running':
      requireEventKeys(input, [])
      return { ...identity, type: input.type }
    case 'wayfinder-finished':
      requireEventKeys(input, ['processResult', 'report'])
      return {
        ...identity,
        type: input.type,
        processResult: decodeProcessResult(input.processResult),
        report: decodeSessionReportEvidence(input.report),
      }
    case 'wayfinder-outcome-unknown-acknowledged':
      requireEventKeys(input, ['unknownEventId'])
      return { ...identity, type: input.type, unknownEventId: requiredString(input.unknownEventId) }
    default:
      throw new Error(`Unsupported Automation event type: ${input.type}.`)
  }
}

function requireEventKeys(input: Record<string, unknown>, variantKeys: readonly string[]): void {
  if (!exactKeys(input, ['id', 'type', 'opportunityId', 'recordedAt', ...variantKeys])) {
    throw new Error('An Automation event has an unsupported shape.')
  }
}

function decodeTarget(input: unknown): AutomationTarget {
  if (!isRecord(input) || !exactKeys(input, ['project', 'mapId', 'ticketId'])) {
    throw new Error('An Automation target has an unsupported shape.')
  }
  return {
    project: decodeProjectKey(input.project),
    mapId: requiredString(input.mapId),
    ticketId: requiredString(input.ticketId),
  }
}

function decodeProjectKey(input: unknown): ProjectKey {
  if (!isRecord(input) || !exactKeys(input, ['integration', 'id'])) {
    throw new Error('An Automation Project key is invalid.')
  }
  if (input.integration !== 'github' && input.integration !== 'local') {
    throw new Error('An Automation Integration is invalid.')
  }
  return { integration: input.integration, id: requiredString(input.id) }
}

function decodeAdmission(input: unknown): AutomationAdmission {
  if (input !== 'automatic' && input !== 'override') {
    throw new Error('An Automation admission is invalid.')
  }
  return input
}

function decodeProcessResult(input: unknown): AutomationProcessResult {
  if (!isRecord(input) || typeof input.status !== 'string') {
    throw new Error('An Automation process result is invalid.')
  }
  if (
    input.status === 'exited' &&
    exactKeys(input, ['status', 'code']) &&
    typeof input.code === 'number' &&
    Number.isSafeInteger(input.code) &&
    input.code >= 0
  ) {
    return { status: 'exited', code: input.code }
  }
  if (input.status === 'signaled' && exactKeys(input, ['status', 'signal'])) {
    return { status: 'signaled', signal: requiredString(input.signal) }
  }
  if (input.status === 'unavailable' && exactKeys(input, ['status', 'reason'])) {
    return { status: 'unavailable', reason: limitedReason(input.reason) }
  }
  throw new Error('An Automation process result is invalid.')
}

function decodeClassificationVerdict(input: unknown): ClassificationVerdict {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['value', 'reason']) ||
    (input.value !== 'afk' && input.value !== 'hitl' && input.value !== 'unable')
  ) {
    throw new Error('An Automation Classification Verdict is invalid.')
  }
  return { value: input.value, reason: limitedReason(input.reason) }
}

function decodeSessionReportEvidence(input: unknown): SessionReportEvidence {
  if (!isRecord(input) || typeof input.status !== 'string') {
    throw new Error('Automation Session report evidence is invalid.')
  }
  if (input.status === 'received' && exactKeys(input, ['status', 'report'])) {
    const report = input.report
    if (
      !isRecord(report) ||
      !exactKeys(report, ['outcome', 'reason']) ||
      (report.outcome !== 'completed' &&
        report.outcome !== 'stopped' &&
        report.outcome !== 'failed')
    ) {
      throw new Error('An Automation Session report is invalid.')
    }
    return {
      status: 'received',
      report: { outcome: report.outcome, reason: limitedReason(report.reason) },
    }
  }
  if (
    (input.status === 'missing' || input.status === 'invalid') &&
    exactKeys(input, ['status', 'reason'])
  ) {
    return { status: input.status, reason: limitedReason(input.reason) }
  }
  throw new Error('Automation Session report evidence is invalid.')
}

function decodeRecordedAt(input: unknown): string {
  const value = requiredString(input)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('An Automation event timestamp is invalid.')
  }
  return value
}

function limitedReason(input: unknown): string {
  const reason = requiredString(input)
  if (reason.length > 1000) throw new Error('An Automation reason is too long.')
  return reason
}

function requiredString(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0)
    throw new Error('Must be a non-empty string.')
  return input
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  const actual = Object.keys(input)
  return actual.length === expected.size && actual.every((key) => expected.has(key))
}

export function automationTargetKey(target: AutomationTarget): string {
  return `${target.project.integration}:${target.project.id}\u0000${target.mapId}\u0000${target.ticketId}`
}

async function atomicWrite(path: string, raw: string): Promise<void> {
  const directory = dirname(path)
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(raw, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, path)
    try {
      const directoryHandle = await open(directory, 'r')
      try {
        await directoryHandle.sync()
      } finally {
        await directoryHandle.close()
      }
    } catch {
      // The file has already been atomically replaced; some filesystems cannot fsync directories.
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}
