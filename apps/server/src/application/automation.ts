import { type ChildProcess, spawn } from 'node:child_process'
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
  RegisteredProject,
  SessionReportEvidence,
  Ticket,
  WayfinderSession,
} from '@roadmap/contracts'
import { isRecord } from '../type-guards.ts'
import {
  CLASSIFICATION_RESULT_SCHEMA_MARKER,
  classificationResultSchemaJson,
  decodeClassificationResult,
} from './classification-contract.ts'
import type { HarnessCommand, RoadmapConfiguration } from './configuration.ts'
import {
  decodeSessionReport,
  SESSION_REPORT_SCHEMA_MARKER,
  sessionReportSchemaJson,
} from './session-report-contract.ts'

const PROMPT_MARKER = '{{roadmap.prompt}}'
const STDOUT_LIMIT = 16 * 1024
const STDERR_LIMIT = 64 * 1024
const RESTART_UNKNOWN_REASON = 'Roadmap restarted before this attempt recorded a terminal result.'
const LEGACY_PROCESS_REASON = 'The previous Automation ledger did not record a process result.'

type LegacyClassificationAttempt =
  | { status: 'attempted' }
  | { status: 'afk' | 'hitl' | 'unable' | 'failed'; reason: string }

type LegacyWayfinderAttempt = { status: 'attempted' | 'started' | 'launch-failed' }

interface LegacyAutomationRecord {
  target: AutomationTarget
  classification: LegacyClassificationAttempt
  wayfinder?: LegacyWayfinderAttempt
}

interface AutomationStore {
  schemaVersion: 2
  records: AutomationEvidence[]
}

export type AutomationLedgerRecord = AutomationEvidence

export interface AutomationDocument {
  load(): Promise<AutomationEvidence[]>
  write(records: readonly AutomationEvidence[]): Promise<void>
}

interface FinishedProcessResult {
  status: 'finished'
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stdoutOversized: boolean
}

export type ClassificationProcessResult =
  | FinishedProcessResult
  | { status: 'launch-failed'; reason: string }
  | { status: 'outcome-unknown'; reason: string }

export type WayfinderProcessResult = FinishedProcessResult

export interface ClassificationProcess {
  completed: Promise<ClassificationProcessResult>
  stop(): Promise<void>
}
export interface WayfinderProcess {
  completed: Promise<WayfinderProcessResult>
}

export interface AutomationLaunch {
  command: HarnessCommand
  workspace: string
  prompt: string
  environment: Record<string, string>
}

export interface AutomationLauncher {
  classify(request: AutomationLaunch): ClassificationProcess
  dispatch(request: AutomationLaunch): Promise<WayfinderProcess>
}

interface AutomationSource {
  configuration: RoadmapConfiguration
  projects: readonly RegisteredProject[]
}

export interface AutomationLoop {
  start(): Promise<void>
  evidence(): AutomationEvidence[]
  reconcile(): void
  stop(): Promise<void>
}

interface Candidate {
  target: AutomationTarget
  mapPointer: string
  ticketPointer: string
  project: RegisteredProject
  ticket: Ticket
}

interface ActiveClassification {
  candidate: Candidate
  process: ClassificationProcess
  admission: AutomationAdmission
}
export function createAutomationLoop(options: {
  document: AutomationDocument
  launcher: AutomationLauncher
  source(): AutomationSource
  onEvidenceChange?(): void
}): AutomationLoop {
  let records = new Map<string, AutomationEvidence>()
  let active: ActiveClassification | null = null
  let started = false
  let accepting = true
  let faulted = false
  let lane: Promise<void> = Promise.resolve()

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const next = lane.then(operation, operation)
    lane = next.catch(() => undefined)
    return next
  }

  async function persist(next: Map<string, AutomationEvidence>): Promise<boolean> {
    try {
      await options.document.write([...next.values()])
      records = next
      options.onEvidenceChange?.()
      return true
    } catch {
      faulted = true
      return false
    }
  }

  async function replace(record: AutomationEvidence): Promise<boolean> {
    const next = new Map(records)
    next.set(targetKey(record.target), record)
    return persist(next)
  }

  async function reconcileNow(): Promise<void> {
    if (!started || !accepting || faulted || active) return
    const source = options.source()
    for (const candidate of selectCandidates(source)) {
      if (!(await advanceCandidate(candidate, source.configuration))) return
    }
  }

  async function advanceCandidate(
    candidate: Candidate,
    configuration: RoadmapConfiguration,
  ): Promise<boolean> {
    const record = records.get(targetKey(candidate.target))
    if (!record) {
      await beginClassification(
        candidate,
        configuration.automation.classificationCommand,
        'automatic',
      )
      return false
    }
    if (
      record.classification.status !== 'completed' ||
      record.classification.verdict.value !== 'afk' ||
      record.wayfinder
    ) {
      return true
    }
    await beginDispatch(candidate, record, configuration.automation.wayfinderCommand, 'automatic')
    return !faulted
  }

  async function beginClassification(
    candidate: Candidate,
    command: HarnessCommand | undefined,
    admission: AutomationAdmission,
  ): Promise<void> {
    if (!command) return
    const marker: AutomationEvidence = {
      target: candidate.target,
      classification: { status: 'running', admission },
    }
    if (!(await replace(marker)) || !accepting) return

    let process: ClassificationProcess
    try {
      process = options.launcher.classify(launchRequest(candidate, command, 'classification'))
    } catch {
      await replace({
        ...marker,
        classification: {
          status: 'launch-failed',
          admission,
          reason: 'The Classification Harness Command could not be launched.',
        },
      })
      await reconcileNow()
      return
    }

    const launched: ActiveClassification = { candidate, process, admission }
    active = launched
    void process.completed.then(
      (result) => enqueue(() => finishClassification(launched, result)),
      () =>
        enqueue(() =>
          finishClassification(launched, {
            status: 'outcome-unknown',
            reason: 'The Classification process result was lost.',
          }),
        ),
    )
  }

  async function finishClassification(
    launched: ActiveClassification,
    result: ClassificationProcessResult,
  ): Promise<void> {
    if (active !== launched) return
    active = null
    if (!accepting) return

    const classification = classificationResult(result, launched.admission)
    const record: AutomationEvidence = {
      target: launched.candidate.target,
      classification,
    }
    if (!(await replace(record))) return

    const source = options.source()
    if (
      classification.status === 'completed' &&
      classification.verdict.value === 'afk' &&
      isEffectivelyEnabled(source.configuration, launched.candidate.target.project)
    ) {
      await beginDispatch(
        launched.candidate,
        record,
        source.configuration.automation.wayfinderCommand,
        'automatic',
      )
    }
    await reconcileNow()
  }

  async function beginDispatch(
    candidate: Candidate,
    record: AutomationEvidence,
    command: HarnessCommand | undefined,
    admission: AutomationAdmission,
  ): Promise<void> {
    if (!command || record.wayfinder) return
    const marker: AutomationEvidence = {
      ...record,
      wayfinder: { status: 'launching', admission },
    }
    if (!(await replace(marker)) || !accepting) return

    let process: WayfinderProcess
    try {
      process = await options.launcher.dispatch(launchRequest(candidate, command, 'wayfinder'))
    } catch {
      await replace({
        ...marker,
        wayfinder: {
          status: 'launch-failed',
          admission,
          reason: 'The Wayfinder Session Command could not be launched.',
        },
      })
      return
    }

    void process.completed.then(
      (result) => enqueue(() => finishWayfinder(candidate.target, admission, result)),
      () =>
        enqueue(() =>
          finishWayfinderUnknown(
            candidate.target,
            admission,
            'The Wayfinder Session process result was lost.',
          ),
        ),
    )
    await replace({ ...marker, wayfinder: { status: 'running', admission } })
  }

  async function finishWayfinder(
    target: AutomationTarget,
    admission: AutomationAdmission,
    result: WayfinderProcessResult,
  ): Promise<void> {
    if (!accepting) return
    const current = records.get(targetKey(target))
    if (!current) return
    if (current.wayfinder?.status !== 'launching' && current.wayfinder?.status !== 'running') return
    await replace({
      ...current,
      wayfinder: {
        status: 'finished',
        admission,
        processResult: observedProcessResult(
          result,
          'The Wayfinder Session process result was lost.',
        ),
        report: sessionReportEvidence(result),
      },
    })
  }

  async function finishWayfinderUnknown(
    target: AutomationTarget,
    admission: AutomationAdmission,
    reason: string,
  ): Promise<void> {
    if (!accepting) return
    const current = records.get(targetKey(target))
    if (!current) return
    if (current.wayfinder?.status !== 'launching' && current.wayfinder?.status !== 'running') return
    await replace({
      ...current,
      wayfinder: { status: 'outcome-unknown', admission, reason },
    })
  }

  return {
    async start() {
      if (started) return
      const loaded = await options.document.load()
      const recovered = loaded.map(recoverAfterRestart)
      const next = new Map(recovered.map((record) => [targetKey(record.target), record]))
      const changed = recovered.some((record, index) => record !== loaded[index])
      if (changed) {
        if (!(await persist(next))) return
      } else {
        records = next
        options.onEvidenceChange?.()
      }
      started = true
      await enqueue(reconcileNow)
    },
    evidence: () => [...records.values()],
    reconcile() {
      if (!started || !accepting) return
      void enqueue(reconcileNow)
    },
    async stop() {
      if (!accepting) return lane
      accepting = false
      const live = active
      if (live) await live.process.stop()
      await lane
    },
  }
}

function selectCandidates(source: AutomationSource): Candidate[] {
  const automation = source.configuration.automation
  if (!automation.enabled || !automation.classificationCommand || !automation.wayfinderCommand) {
    return []
  }
  const projects = new Map(source.projects.map((project) => [projectKey(project.key), project]))
  return automation.enabledProjects.flatMap((enabled): Candidate[] => {
    const candidate = selectCandidate(projects.get(projectKey(enabled)))
    return candidate ? [candidate] : []
  })
}

function selectCandidate(project: RegisteredProject | undefined): Candidate | null {
  if (project?.availability.status !== 'available') return null
  const map = project.openMaps[0]
  if (!map?.ticketsComplete) return null
  const ticket = map.frontier[0]
  if (
    !ticket?.blockersComplete ||
    ticket.typeEvidence.kind !== 'recognized' ||
    ticket.typeEvidence.value !== 'task'
  ) {
    return null
  }
  const mapPointer = map.url ?? map.sourcePath
  const ticketPointer = ticket.url ?? ticket.sourcePath
  if (!mapPointer || !ticketPointer) return null
  return {
    target: { project: project.key, mapId: map.id, ticketId: ticket.id },
    mapPointer,
    ticketPointer,
    project,
    ticket,
  }
}

function isEffectivelyEnabled(configuration: RoadmapConfiguration, project: ProjectKey): boolean {
  return (
    configuration.automation.enabled &&
    configuration.automation.enabledProjects.some((candidate) => sameProject(candidate, project))
  )
}

function launchRequest(
  candidate: Candidate,
  command: HarnessCommand,
  kind: 'classification' | 'wayfinder',
): AutomationLaunch {
  const environment: Record<string, string> = {
    ROADMAP_RUN_ID: randomUUID(),
    ROADMAP_RUN_KIND: kind,
    ROADMAP_PROJECT_KEY: projectKey(candidate.target.project),
    ROADMAP_MAP_ID: candidate.target.mapId,
    ROADMAP_TICKET_ID: candidate.target.ticketId,
  }
  return {
    command,
    workspace: candidate.project.workspace.path,
    prompt: renderPrompt(command.promptTemplate, candidate),
    environment,
  }
}

function renderPrompt(promptTemplate: string, candidate: Candidate): string {
  return promptTemplate
    .replaceAll('{{roadmap.map}}', () => candidate.mapPointer)
    .replaceAll('{{roadmap.ticket}}', () => candidate.ticketPointer)
    .replaceAll(CLASSIFICATION_RESULT_SCHEMA_MARKER, () => classificationResultSchemaJson)
    .replaceAll(SESSION_REPORT_SCHEMA_MARKER, () => sessionReportSchemaJson)
}

function classificationResult(
  result: ClassificationProcessResult,
  admission: AutomationAdmission,
): ClassificationAttempt {
  if (result.status === 'launch-failed') {
    return { status: 'launch-failed', admission, reason: result.reason }
  }
  if (result.status === 'outcome-unknown') {
    return { status: 'outcome-unknown', admission, reason: result.reason }
  }
  const processResult = observedProcessResult(result, 'The Classification process result was lost.')
  if (result.signal || result.code !== 0) {
    const detail = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.code ?? 'unknown'}`
    return {
      status: 'failed',
      admission,
      processResult,
      reason: `Classification process failed with ${detail}.`,
    }
  }
  if (result.stdoutOversized) {
    return {
      status: 'failed',
      admission,
      processResult,
      reason: `Classification stdout exceeded ${STDOUT_LIMIT} bytes.`,
    }
  }
  const decoded = decodeClassificationResult(result.stdout)
  return decoded
    ? {
        status: 'completed',
        admission,
        processResult,
        verdict: { value: decoded.verdict, reason: decoded.reason },
      }
    : {
        status: 'failed',
        admission,
        processResult,
        reason: 'Classification stdout did not match the current result contract.',
      }
}

function observedProcessResult(
  result: FinishedProcessResult,
  unavailableReason: string,
): AutomationProcessResult {
  if (result.signal) return { status: 'signaled', signal: result.signal }
  if (result.code !== null) return { status: 'exited', code: result.code }
  return { status: 'unavailable', reason: unavailableReason }
}

function sessionReportEvidence(result: WayfinderProcessResult): SessionReportEvidence {
  if (result.stdoutOversized) {
    return {
      status: 'invalid',
      reason: `Wayfinder Session stdout exceeded ${STDOUT_LIMIT} bytes.`,
    }
  }
  if (result.stdout.trim().length === 0) {
    return { status: 'missing', reason: 'The Wayfinder Session produced no Session report.' }
  }
  const decoded = decodeSessionReport(result.stdout)
  return decoded
    ? {
        status: 'received',
        report: { outcome: decoded.outcome, reason: decoded.reason },
      }
    : {
        status: 'invalid',
        reason: 'Wayfinder Session stdout did not match the current report contract.',
      }
}

export function createAutomationDocument(path: string): AutomationDocument {
  return {
    async load() {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (error) {
        if (isMissing(error)) return []
        throw new Error('The Automation ledger could not be read.')
      }
      let input: unknown
      try {
        input = JSON.parse(raw)
      } catch {
        throw new Error('The Automation ledger contains invalid JSON.')
      }
      const decoded = decodeStore(input)
      if (decoded.migrated) await writeAutomationStore(path, decoded.records)
      return decoded.records
    },
    write(records) {
      return writeAutomationStore(path, records)
    },
  }
}

async function writeAutomationStore(
  path: string,
  records: readonly AutomationEvidence[],
): Promise<void> {
  const store: AutomationStore = { schemaVersion: 2, records: [...records] }
  await atomicWrite(path, `${JSON.stringify(store, null, 2)}\n`)
}

function decodeStore(input: unknown): { records: AutomationEvidence[]; migrated: boolean } {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['schemaVersion', 'records']) ||
    !Array.isArray(input.records)
  ) {
    throw new Error('The Automation ledger has an unsupported shape.')
  }
  const migrated = input.schemaVersion === 1
  if (!migrated && input.schemaVersion !== 2) {
    throw new Error('The Automation ledger has an unsupported shape.')
  }
  const records = migrated
    ? input.records.map((record) => migrateLegacyRecord(decodeLegacyRecord(record)))
    : input.records.map(decodeRecord)
  const targets = new Set<string>()
  for (const record of records) {
    const key = targetKey(record.target)
    if (targets.has(key)) throw new Error('The Automation ledger repeats a ticket identity.')
    targets.add(key)
  }
  return { records, migrated }
}

function decodeRecord(input: unknown): AutomationEvidence {
  if (!isRecord(input) || !exactKeys(input, ['target', 'classification', 'wayfinder'])) {
    throw new Error('An Automation record has an unsupported shape.')
  }
  const classification = decodeClassificationAttempt(input.classification)
  const wayfinder =
    input.wayfinder === undefined ? undefined : decodeWayfinderSession(input.wayfinder)
  if (
    wayfinder &&
    (classification.status !== 'completed' || classification.verdict.value !== 'afk')
  ) {
    throw new Error('An Automation Wayfinder Session requires an AFK Classification Verdict.')
  }
  return {
    target: decodeTarget(input.target),
    classification,
    ...(wayfinder ? { wayfinder } : {}),
  }
}

function decodeLegacyRecord(input: unknown): LegacyAutomationRecord {
  if (!isRecord(input) || !exactKeys(input, ['target', 'classification', 'wayfinder'])) {
    throw new Error('An Automation record has an unsupported shape.')
  }
  const classification = decodeLegacyClassificationAttempt(input.classification)
  const wayfinder =
    input.wayfinder === undefined ? undefined : decodeLegacyWayfinderAttempt(input.wayfinder)
  if (wayfinder && classification.status !== 'afk') {
    throw new Error('An Automation Wayfinder attempt requires an AFK classification.')
  }
  return {
    target: decodeTarget(input.target),
    classification,
    ...(wayfinder ? { wayfinder } : {}),
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

function decodeClassificationAttempt(input: unknown): ClassificationAttempt {
  if (!isRecord(input) || typeof input.status !== 'string') {
    throw new Error('An Automation Classification attempt is invalid.')
  }
  const admission = decodeAdmission(input.admission)
  if (input.status === 'running' && exactKeys(input, ['status', 'admission'])) {
    return { status: 'running', admission }
  }
  if (
    input.status === 'completed' &&
    exactKeys(input, ['status', 'admission', 'processResult', 'verdict'])
  ) {
    return {
      status: 'completed',
      admission,
      processResult: decodeProcessResult(input.processResult),
      verdict: decodeClassificationVerdict(input.verdict),
    }
  }
  if (
    input.status === 'failed' &&
    exactKeys(input, ['status', 'admission', 'processResult', 'reason'])
  ) {
    return {
      status: 'failed',
      admission,
      processResult: decodeProcessResult(input.processResult),
      reason: limitedReason(input.reason),
    }
  }
  if (
    (input.status === 'launch-failed' || input.status === 'outcome-unknown') &&
    exactKeys(input, ['status', 'admission', 'reason'])
  ) {
    return { status: input.status, admission, reason: limitedReason(input.reason) }
  }
  throw new Error('An Automation Classification attempt is invalid.')
}

function decodeWayfinderSession(input: unknown): WayfinderSession {
  if (!isRecord(input) || typeof input.status !== 'string') {
    throw new Error('An Automation Wayfinder Session is invalid.')
  }
  const admission = decodeAdmission(input.admission)
  if (
    (input.status === 'launching' || input.status === 'running') &&
    exactKeys(input, ['status', 'admission'])
  ) {
    return { status: input.status, admission }
  }
  if (
    input.status === 'finished' &&
    exactKeys(input, ['status', 'admission', 'processResult', 'report'])
  ) {
    return {
      status: 'finished',
      admission,
      processResult: decodeProcessResult(input.processResult),
      report: decodeSessionReportEvidence(input.report),
    }
  }
  if (
    (input.status === 'launch-failed' || input.status === 'outcome-unknown') &&
    exactKeys(input, ['status', 'admission', 'reason'])
  ) {
    return { status: input.status, admission, reason: limitedReason(input.reason) }
  }
  throw new Error('An Automation Wayfinder Session is invalid.')
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

function decodeLegacyClassificationAttempt(input: unknown): LegacyClassificationAttempt {
  if (!isRecord(input) || typeof input.status !== 'string') {
    throw new Error('An Automation classification attempt is invalid.')
  }
  if (input.status === 'attempted' && exactKeys(input, ['status'])) return { status: 'attempted' }
  if (
    (input.status === 'afk' ||
      input.status === 'hitl' ||
      input.status === 'unable' ||
      input.status === 'failed') &&
    exactKeys(input, ['status', 'reason'])
  ) {
    return { status: input.status, reason: limitedReason(input.reason) }
  }
  throw new Error('An Automation classification attempt is invalid.')
}

function decodeLegacyWayfinderAttempt(input: unknown): LegacyWayfinderAttempt {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['status']) ||
    (input.status !== 'attempted' && input.status !== 'started' && input.status !== 'launch-failed')
  ) {
    throw new Error('An Automation Wayfinder attempt is invalid.')
  }
  return { status: input.status }
}

function migrateLegacyRecord(record: LegacyAutomationRecord): AutomationEvidence {
  const classification = migrateLegacyClassification(record.classification)
  return {
    target: record.target,
    classification,
    ...(record.wayfinder ? { wayfinder: migrateLegacyWayfinder(record.wayfinder) } : {}),
  }
}

function migrateLegacyClassification(input: LegacyClassificationAttempt): ClassificationAttempt {
  if (input.status === 'attempted') {
    return { status: 'outcome-unknown', admission: 'automatic', reason: RESTART_UNKNOWN_REASON }
  }
  if (input.status === 'failed') {
    return {
      status: 'failed',
      admission: 'automatic',
      processResult: { status: 'unavailable', reason: LEGACY_PROCESS_REASON },
      reason: input.reason,
    }
  }
  return {
    status: 'completed',
    admission: 'automatic',
    processResult: { status: 'exited', code: 0 },
    verdict: { value: input.status, reason: input.reason },
  }
}

function migrateLegacyWayfinder(input: LegacyWayfinderAttempt): WayfinderSession {
  if (input.status === 'launch-failed') {
    return {
      status: 'launch-failed',
      admission: 'automatic',
      reason: 'The previous ledger recorded that the Wayfinder Session failed to launch.',
    }
  }
  return { status: 'outcome-unknown', admission: 'automatic', reason: RESTART_UNKNOWN_REASON }
}

function recoverAfterRestart(record: AutomationEvidence): AutomationEvidence {
  const classification =
    record.classification.status === 'running'
      ? {
          status: 'outcome-unknown' as const,
          admission: record.classification.admission,
          reason: RESTART_UNKNOWN_REASON,
        }
      : record.classification
  const wayfinder =
    record.wayfinder?.status === 'launching' || record.wayfinder?.status === 'running'
      ? {
          status: 'outcome-unknown' as const,
          admission: record.wayfinder.admission,
          reason: RESTART_UNKNOWN_REASON,
        }
      : record.wayfinder
  if (classification === record.classification && wayfinder === record.wayfinder) return record
  return { target: record.target, classification, ...(wayfinder ? { wayfinder } : {}) }
}

function limitedReason(input: unknown): string {
  const reason = requiredString(input)
  if (reason.length > 1000) throw new Error('An Automation reason is too long.')
  return reason
}

export function createAutomationLauncher(
  options: { stopGraceMs?: number } = {},
): AutomationLauncher {
  const stopGraceMs = options.stopGraceMs ?? 1_000
  return {
    classify(request) {
      const child = spawnCommand(request, ['pipe', 'pipe'])
      const stdout = boundedCapture(child.stdout, STDOUT_LIMIT, false)
      boundedCapture(child.stderr, STDERR_LIMIT, true)
      let launchError: string | null = null
      let closed = false
      const { promise: completed, resolve } = Promise.withResolvers<ClassificationProcessResult>()
      child.once('error', (error) => {
        launchError = processError(error, 'Classification Harness Command')
      })
      child.once('close', (code, signal) => {
        closed = true
        resolve(
          launchError
            ? { status: 'launch-failed', reason: launchError }
            : {
                status: 'finished',
                code,
                signal,
                stdout: stdout.text(),
                stdoutOversized: stdout.truncated(),
              },
        )
      })
      deliverStdin(child, request)
      return {
        completed,
        async stop() {
          if (closed) return
          signalOwnedProcess(child, 'SIGTERM')
          await Promise.race([completed, delay(stopGraceMs)])
          if (!closed) signalOwnedProcess(child, 'SIGKILL')
          await completed
        },
      }
    },
    dispatch(request) {
      const child = spawnCommand(request, ['pipe', 'pipe'])
      const stdout = boundedCapture(child.stdout, STDOUT_LIMIT, false)
      boundedCapture(child.stderr, STDERR_LIMIT, true)
      const {
        promise: launched,
        resolve: resolveLaunched,
        reject: rejectLaunched,
      } = Promise.withResolvers<WayfinderProcess>()
      const { promise: completed, resolve: resolveCompleted } =
        Promise.withResolvers<WayfinderProcessResult>()
      child.once('error', (error) => {
        rejectLaunched(new Error(processError(error, 'Wayfinder Session Command')))
      })
      child.once('spawn', () => {
        child.unref()
        unrefReadable(child.stdout)
        unrefReadable(child.stderr)
        resolveLaunched({ completed })
      })
      child.once('close', (code, signal) => {
        resolveCompleted({
          status: 'finished',
          code,
          signal,
          stdout: stdout.text(),
          stdoutOversized: stdout.truncated(),
        })
      })
      deliverStdin(child, request)
      return launched
    },
  }
}

function spawnCommand(
  request: AutomationLaunch,
  output: ['pipe' | 'ignore', 'pipe' | 'ignore'],
): ChildProcess {
  const args = request.command.args.map((argument) =>
    argument === PROMPT_MARKER ? request.prompt : argument,
  )
  return spawn(request.command.command, args, {
    cwd: request.workspace,
    detached: true,
    env: { ...process.env, ...request.environment },
    shell: false,
    stdio: [request.command.promptDelivery === 'stdin' ? 'pipe' : 'ignore', ...output],
  })
}

function deliverStdin(child: ChildProcess, request: AutomationLaunch): void {
  if (request.command.promptDelivery !== 'stdin') return
  child.stdin?.on('error', () => undefined)
  child.stdin?.end(request.prompt, 'utf8')
}
function unrefReadable(stream: NodeJS.ReadableStream | null): void {
  if (stream && 'unref' in stream && typeof stream.unref === 'function') stream.unref()
}

function boundedCapture(
  stream: NodeJS.ReadableStream | null,
  limit: number,
  keepTail: boolean,
): { text(): string; truncated(): boolean } {
  let chunks: Buffer[] = []
  let size = 0
  let wasTruncated = false
  stream?.on('data', (value: unknown) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
    if (keepTail) {
      const combined = Buffer.concat([...chunks, chunk])
      wasTruncated ||= combined.length > limit
      const kept = combined.subarray(Math.max(0, combined.length - limit))
      chunks = [kept]
      size = kept.length
      return
    }
    if (size >= limit) {
      wasTruncated = true
      return
    }
    const kept = chunk.subarray(0, limit - size)
    chunks.push(kept)
    size += kept.length
    if (kept.length < chunk.length) wasTruncated = true
  })
  return {
    text: () => Buffer.concat(chunks, size).toString('utf8'),
    truncated: () => wasTruncated,
  }
}

function signalOwnedProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    // ESRCH means the owned process group already exited; `close` remains authoritative.
  }
}

function processError(error: Error & { code?: string }, commandName: string): string {
  return error.code
    ? `The ${commandName} could not be launched (${error.code}).`
    : `The ${commandName} could not be launched.`
}

async function atomicWrite(path: string, raw: string): Promise<void> {
  const directory = dirname(path)
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  let file: Awaited<ReturnType<typeof open>> | null = null
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(raw, 'utf8')
    await file.sync()
    await file.close()
    file = null
    await rename(temporary, path)
    const directoryHandle = await open(directory, 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    await file?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function targetKey(target: AutomationTarget): string {
  return JSON.stringify([
    target.project.integration,
    target.project.id,
    target.mapId,
    target.ticketId,
  ])
}

function requiredString(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('A required Automation string is invalid.')
  }
  return input
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(input).every((key) => allowed.has(key))
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function projectKey(project: ProjectKey): string {
  return `${project.integration}:${project.id}`
}

function sameProject(left: ProjectKey, right: ProjectKey): boolean {
  return left.integration === right.integration && left.id === right.id
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}
