import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  AutomationAdmission,
  AutomationEvidence,
  AutomationOverrideAvailability,
  AutomationOverrideControl,
  AutomationOverrideStage,
  AutomationProcessResult,
  AutomationTarget,
  ClassificationAttempt,
  ProjectKey,
  RegisteredProject,
  SafeError,
  SessionReportEvidence,
  Ticket,
  WayfinderMap,
} from '@roadmap/contracts'
import {
  type AutomationAppend,
  type AutomationDatabase,
  type AutomationDatabaseDocument,
  type AutomationEvent,
  type AutomationOpportunity,
  type AutomationRecord,
  automationTargetKey,
  replayAutomationDatabase,
} from './automation-database.ts'
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
  overrides(): AutomationOverrideControl[]
  startOverride(
    target: AutomationTarget,
    stage: AutomationOverrideStage,
  ): Promise<{ ok: true } | { ok: false; error: SafeError }>
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
type CandidateResolution =
  | { ok: true; target: AutomationTarget; candidate: Candidate }
  | { ok: false; target: AutomationTarget; reason: string }

interface ActiveClassification {
  candidate: Candidate
  opportunityId: string
  process: ClassificationProcess
  admission: AutomationAdmission
}
export function createAutomationLoop(options: {
  database: AutomationDatabaseDocument
  launcher: AutomationLauncher
  source(): AutomationSource
  onEvidenceChange?(): void
}): AutomationLoop {
  let records = new Map<string, AutomationRecord>()
  let currentEvidence: readonly AutomationEvidence[] = []
  let active: ActiveClassification | null = null
  let started = false
  let accepting = true
  let faulted = false
  let lane: Promise<void> = Promise.resolve()

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = lane.then(operation, operation)
    lane = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  function install(database: AutomationDatabase): void {
    const projection = replayAutomationDatabase(database)
    currentEvidence = projection.evidence
    records = new Map(
      projection.records.map((record) => [automationTargetKey(record.opportunity.target), record]),
    )
    options.onEvidenceChange?.()
  }

  async function append(batch: AutomationAppend): Promise<boolean> {
    try {
      install(await options.database.append(batch))
      return true
    } catch {
      faulted = true
      options.onEvidenceChange?.()
      return false
    }
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
    const record = records.get(automationTargetKey(candidate.target))
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
      record.wayfinder?.status !== 'queued'
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
  ): Promise<boolean> {
    if (!command || records.has(automationTargetKey(candidate.target))) return false
    const opportunity: AutomationOpportunity = { id: randomUUID(), target: candidate.target }
    const startedEvent = {
      ...eventIdentity(opportunity.id),
      type: 'classification-started',
      admission,
    } satisfies AutomationEvent
    if (!(await append({ opportunities: [opportunity], events: [startedEvent] })) || !accepting) {
      return false
    }

    let process: ClassificationProcess
    try {
      process = options.launcher.classify(launchRequest(candidate, command, 'classification'))
    } catch {
      const replaced = await append({
        events: [
          {
            ...eventIdentity(opportunity.id),
            type: 'classification-launch-failed',
            reason: 'The Classification Harness Command could not be launched.',
          },
        ],
      })
      await reconcileNow()
      return replaced
    }

    const launched: ActiveClassification = {
      candidate,
      opportunityId: opportunity.id,
      process,
      admission,
    }
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
    return true
  }

  async function finishClassification(
    launched: ActiveClassification,
    result: ClassificationProcessResult,
  ): Promise<void> {
    if (active !== launched) return
    active = null
    if (!accepting) return

    const classification = classificationResult(result, launched.admission)
    if (
      !(await append({ events: [classificationEvent(launched.opportunityId, classification)] }))
    ) {
      return
    }

    const source = options.source()
    const record = records.get(automationTargetKey(launched.candidate.target))
    if (
      record &&
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
    record: AutomationRecord,
    command: HarnessCommand | undefined,
    admission: AutomationAdmission,
  ): Promise<boolean> {
    if (!command || record.wayfinder?.status !== 'queued') return false
    if (
      !(await append({
        events: [
          {
            ...eventIdentity(record.opportunity.id),
            type: 'wayfinder-launching',
            admission,
          },
        ],
      })) ||
      !accepting
    ) {
      return false
    }

    let process: WayfinderProcess
    try {
      process = await options.launcher.dispatch(launchRequest(candidate, command, 'wayfinder'))
    } catch {
      return append({
        events: [
          {
            ...eventIdentity(record.opportunity.id),
            type: 'wayfinder-launch-failed',
            reason: 'The Wayfinder Session Command could not be launched.',
          },
        ],
      })
    }

    void process.completed.then(
      (result) => enqueue(() => finishWayfinder(candidate.target, result)),
      () =>
        enqueue(() =>
          finishWayfinderUnknown(
            candidate.target,
            'The Wayfinder Session process result was lost.',
          ),
        ),
    )
    return append({
      events: [{ ...eventIdentity(record.opportunity.id), type: 'wayfinder-running' }],
    })
  }

  async function finishWayfinder(
    target: AutomationTarget,
    result: WayfinderProcessResult,
  ): Promise<void> {
    if (!accepting) return
    const current = records.get(automationTargetKey(target))
    if (
      !current ||
      (current.wayfinder?.status !== 'launching' && current.wayfinder?.status !== 'running')
    ) {
      return
    }
    await append({
      events: [
        {
          ...eventIdentity(current.opportunity.id),
          type: 'wayfinder-finished',
          processResult: observedProcessResult(
            result,
            'The Wayfinder Session process result was lost.',
          ),
          report: sessionReportEvidence(result),
        },
      ],
    })
  }

  async function finishWayfinderUnknown(target: AutomationTarget, reason: string): Promise<void> {
    if (!accepting) return
    const current = records.get(automationTargetKey(target))
    if (
      !current ||
      (current.wayfinder?.status !== 'launching' && current.wayfinder?.status !== 'running')
    ) {
      return
    }
    await append({
      events: [
        {
          ...eventIdentity(current.opportunity.id),
          type: 'wayfinder-outcome-unknown',
          reason,
        },
      ],
    })
  }

  function overrideControls(): AutomationOverrideControl[] {
    const source = options.source()
    return source.projects.flatMap((project) =>
      [...project.openMaps, ...project.closedMaps].flatMap((map) =>
        map.tickets.map((ticket) => {
          const resolved = resolveCandidate(project, map, ticket)
          return {
            target: resolved.target,
            classification: overrideAvailability('classification', resolved, source.configuration),
            wayfinder: overrideAvailability('wayfinder', resolved, source.configuration),
          }
        }),
      ),
    )
  }

  function overrideAvailability(
    stage: AutomationOverrideStage,
    resolved: CandidateResolution,
    configuration: RoadmapConfiguration,
  ): AutomationOverrideAvailability {
    const unavailable = commonOverrideIneligibility(resolved)
    if (unavailable) return unavailable
    if (!resolved.ok) return ineligible(resolved.reason)
    const record = records.get(automationTargetKey(resolved.target))
    return stage === 'classification'
      ? classificationOverrideAvailability(configuration, record)
      : wayfinderOverrideAvailability(configuration, record)
  }

  function commonOverrideIneligibility(
    resolved: CandidateResolution,
  ): AutomationOverrideAvailability | null {
    if (!accepting) return ineligible('Roadmap is stopping.')
    if (faulted) return ineligible('Automation evidence could not be persisted; restart Roadmap.')
    return resolved.ok ? null : ineligible(resolved.reason)
  }

  function classificationOverrideAvailability(
    configuration: RoadmapConfiguration,
    record: AutomationRecord | undefined,
  ): AutomationOverrideAvailability {
    if (!configuration.automation.classificationCommand) {
      return ineligible('Configure the Classification Harness Command in roadmap.config.json.')
    }
    if (record) return ineligible('This Automation opportunity has already been classified.')
    if (
      active ||
      [...records.values()].some((entry) => entry.classification.status === 'running')
    ) {
      return ineligible('Another Classification Run is in progress.')
    }
    return { status: 'eligible' }
  }

  function wayfinderOverrideAvailability(
    configuration: RoadmapConfiguration,
    record: AutomationRecord | undefined,
  ): AutomationOverrideAvailability {
    if (!configuration.automation.wayfinderCommand) {
      return ineligible('Configure the Wayfinder Session Command in roadmap.config.json.')
    }
    if (!record) return ineligible('Run Classification first.')
    if (record.classification.status === 'running') {
      return ineligible('Classification is still running.')
    }
    if (
      record.classification.status !== 'completed' ||
      record.classification.verdict.value !== 'afk'
    ) {
      return ineligible('Classification did not produce an AFK Verdict.')
    }
    if (record.wayfinder?.status !== 'queued') {
      return ineligible('A Wayfinder Session is already recorded for this opportunity.')
    }
    return { status: 'eligible' }
  }

  function startOverride(
    target: AutomationTarget,
    stage: AutomationOverrideStage,
  ): Promise<{ ok: true } | { ok: false; error: SafeError }> {
    return enqueue(() => startOverrideNow(target, stage))
  }

  async function startOverrideNow(
    target: AutomationTarget,
    stage: AutomationOverrideStage,
  ): Promise<{ ok: true } | { ok: false; error: SafeError }> {
    const source = options.source()
    const resolved = resolveTarget(source, target)
    const availability = overrideAvailability(stage, resolved, source.configuration)
    if (availability.status === 'ineligible') {
      return { ok: false, error: overrideError(availability.reason) }
    }
    if (!resolved.ok) return { ok: false, error: overrideError(resolved.reason) }

    const launched = await launchOverride(resolved.candidate, stage, source.configuration)
    if (launched) return { ok: true }
    return {
      ok: false,
      error: faulted
        ? overrideError('Automation evidence could not be persisted.', 'persistence-failed')
        : overrideError('Automation is no longer accepting overrides.', 'not-supported'),
    }
  }

  async function launchOverride(
    candidate: Candidate,
    stage: AutomationOverrideStage,
    configuration: RoadmapConfiguration,
  ): Promise<boolean> {
    if (stage === 'classification') {
      return beginClassification(
        candidate,
        configuration.automation.classificationCommand,
        'override',
      )
    }
    const record = records.get(automationTargetKey(candidate.target))
    return record
      ? beginDispatch(candidate, record, configuration.automation.wayfinderCommand, 'override')
      : false
  }

  return {
    async start() {
      if (started) return
      install(await options.database.load())
      const recovery = restartRecoveryEvents(records.values())
      if (recovery.length > 0 && !(await append({ events: recovery }))) return
      started = true
      await enqueue(reconcileNow)
    },
    evidence: () => [...currentEvidence],
    overrides: overrideControls,
    startOverride,
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
  const map = project?.openMaps[0]
  const ticket = map?.frontier[0]
  if (!project || !map || !ticket) return null
  const resolved = resolveCandidate(project, map, ticket)
  return resolved.ok ? resolved.candidate : null
}

function resolveTarget(source: AutomationSource, target: AutomationTarget): CandidateResolution {
  const project = source.projects.find((candidate) => sameProject(candidate.key, target.project))
  if (!project) return { ok: false, target, reason: 'Project does not exist.' }
  const map = [...project.openMaps, ...project.closedMaps].find(
    (candidate) => candidate.id === target.mapId,
  )
  if (!map) return { ok: false, target, reason: 'Map does not exist.' }
  const ticket = map.tickets.find((candidate) => candidate.id === target.ticketId)
  if (!ticket) return { ok: false, target, reason: 'Ticket does not exist.' }
  return resolveCandidate(project, map, ticket)
}

function resolveCandidate(
  project: RegisteredProject,
  map: WayfinderMap,
  ticket: Ticket,
): CandidateResolution {
  const target = { project: project.key, mapId: map.id, ticketId: ticket.id }
  if (project.availability.status !== 'available') {
    return { ok: false, target, reason: 'Project is unavailable.' }
  }
  if (project.openMaps[0]?.id !== map.id) {
    return { ok: false, target, reason: 'Ticket is not on the Project’s active map.' }
  }
  if (!map.ticketsComplete) {
    return { ok: false, target, reason: 'The active map’s ticket list is incomplete.' }
  }
  const ineligibility = ticketIneligibility(map, ticket)
  if (ineligibility) return { ok: false, target, reason: ineligibility }
  const mapPointer = map.url ?? map.sourcePath
  const ticketPointer = ticket.url ?? ticket.sourcePath
  if (!mapPointer || !ticketPointer) {
    return { ok: false, target, reason: 'The Integration cannot provide map and ticket pointers.' }
  }
  return {
    ok: true,
    target,
    candidate: { target, mapPointer, ticketPointer, project, ticket },
  }
}
function ticketIneligibility(map: WayfinderMap, ticket: Ticket): string | null {
  if (!ticket.blockersComplete) return 'Ticket blocker data is incomplete.'
  if (ticket.typeEvidence.kind !== 'recognized' || ticket.typeEvidence.value !== 'task') {
    return 'Only task tickets can use Automation.'
  }
  if (ticket.state === 'closed') return 'Ticket is already decided.'
  if (ticket.isBlocked && ticket.isClaimed) return 'Ticket is blocked and claimed.'
  if (ticket.isBlocked) return 'Ticket is blocked.'
  if (ticket.isClaimed) return 'Ticket is already claimed.'
  if (!map.frontier.some((candidate) => candidate.id === ticket.id)) {
    return 'Ticket is not on the frontier.'
  }
  return null
}

function ineligible(reason: string): AutomationOverrideAvailability {
  return { status: 'ineligible', reason }
}

function overrideError(message: string, code: SafeError['code'] = 'validation'): SafeError {
  return { code, message, field: 'target' }
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

function eventIdentity(opportunityId: string): {
  id: string
  opportunityId: string
  recordedAt: string
} {
  return { id: randomUUID(), opportunityId, recordedAt: new Date().toISOString() }
}

function classificationEvent(
  opportunityId: string,
  classification: ClassificationAttempt,
): AutomationEvent {
  const identity = eventIdentity(opportunityId)
  switch (classification.status) {
    case 'running':
      throw new Error('A running Classification cannot be recorded as a terminal event.')
    case 'completed':
      return {
        ...identity,
        type: 'classification-completed',
        processResult: classification.processResult,
        verdict: classification.verdict,
      }
    case 'failed':
      return {
        ...identity,
        type: 'classification-failed',
        processResult: classification.processResult,
        reason: classification.reason,
      }
    case 'launch-failed':
      return { ...identity, type: 'classification-launch-failed', reason: classification.reason }
    case 'outcome-unknown':
      return { ...identity, type: 'classification-outcome-unknown', reason: classification.reason }
    default: {
      const _exhaustive: never = classification
      return _exhaustive
    }
  }
}

function restartRecoveryEvents(records: Iterable<AutomationRecord>): AutomationEvent[] {
  const events: AutomationEvent[] = []
  for (const record of records) {
    if (record.classification.status === 'running') {
      events.push({
        ...eventIdentity(record.opportunity.id),
        type: 'classification-outcome-unknown',
        reason: RESTART_UNKNOWN_REASON,
      })
    }
    if (record.wayfinder?.status === 'launching' || record.wayfinder?.status === 'running') {
      events.push({
        ...eventIdentity(record.opportunity.id),
        type: 'wayfinder-outcome-unknown',
        reason: RESTART_UNKNOWN_REASON,
      })
    }
  }
  return events
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
