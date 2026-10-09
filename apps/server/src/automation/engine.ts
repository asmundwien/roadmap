import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  AutomationEvidence as PublicAutomationEvidence,
  AutomationOverrideControl as PublicAutomationOverrideControl,
  SafeError,
} from '@roadmap/contracts'
import {
  CLASSIFICATION_RESULT_SCHEMA_MARKER,
  classificationResultSchemaJson,
  decodeClassificationResult,
} from '../application/classification-contract.ts'
import {
  decodeSessionReport,
  SESSION_REPORT_SCHEMA_MARKER,
  sessionReportSchemaJson,
} from '../application/session-report-contract.ts'
import type { SourceProjectKey as ProjectKey, SourceTicketContent } from '../observation/source.ts'
import type { HarnessCommand, ProjectConfiguration } from '../projects/registry.ts'
import type {
  CatalogMap,
  CatalogProject,
  CatalogTicket,
  ResourceCatalogSnapshot,
} from '../resources/catalog.ts'
import {
  type AutomationAppend,
  type AutomationDatabase,
  type AutomationDatabaseDocument,
  type AutomationEvent,
  type AutomationOpportunity,
  type AutomationRecord,
  automationTargetKey,
  replayAutomationDatabase,
} from './database.ts'
import type {
  AutomationAdmission,
  AutomationEvidence,
  AutomationOverrideAvailability,
  AutomationOverrideControl,
  AutomationOverrideStage,
  AutomationProcessResult,
  AutomationTarget,
  ClassificationAttempt,
  SessionReportEvidence,
} from './model.ts'

const PROMPT_MARKER = '{{roadmap.prompt}}'
const STDOUT_LIMIT = 16 * 1024
const STDERR_LIMIT = 64 * 1024
const RESTART_UNKNOWN_REASON = 'Roadmap restarted before this attempt recorded a terminal result.'
const STOP_UNKNOWN_REASON = 'Roadmap stopped before this Session recorded a terminal result.'

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

interface ClassificationProcess {
  completed: Promise<ClassificationProcessResult>
  stop(): Promise<void>
}
interface WayfinderProcess {
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

export interface AutomationEngine {
  start(): Promise<void>
  evidence(): PublicAutomationEvidence[]
  overrides(): PublicAutomationOverrideControl[]
  interruptedProjects(): ProjectKey[]
  acknowledgeProjectInterruption(
    project: ProjectKey,
  ): Promise<{ ok: true } | { ok: false; error: SafeError }>
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
  project: CatalogProject
  workspace: string
  sourceDependency: string
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
interface ActiveWayfinder {
  target: AutomationTarget
  process: WayfinderProcess
}

type LaunchResult =
  | { kind: 'admitted' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'persistence-failed' }

interface PreparedLaunch {
  candidate: Candidate
  command: HarnessCommand
}

type LaunchPreparation = { ok: true; prepared: PreparedLaunch } | { ok: false; reason: string }
export function createAutomationEngine(options: {
  database: AutomationDatabaseDocument
  launcher: AutomationLauncher
  resources(): ResourceCatalogSnapshot | null
  onEvidenceChange?(): void
}): AutomationEngine {
  let records = new Map<string, AutomationRecord>()
  let currentEvidence: readonly AutomationEvidence[] = []
  let activeClassification: ActiveClassification | null = null
  const activeWayfinders = new Map<string, ActiveWayfinder>()
  let started = false
  let accepting = true
  let faulted = false
  let lane: Promise<void> = Promise.resolve()

  function resourcesNow(): ResourceCatalogSnapshot | null {
    return options.resources()
  }

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
      const result = await options.database.append(batch)
      if (result.durability !== 'confirmed') faulted = true
      install(result.database)
      return result.durability === 'confirmed'
    } catch {
      faulted = true
      options.onEvidenceChange?.()
      return false
    }
  }

  async function reconcileNow(): Promise<void> {
    if (!started || !accepting || faulted) return
    await reconcileWayfinders()
    if (!accepting || faulted || activeClassification) return
    await reconcileClassification()
  }

  function projectHasUnacknowledgedInterruption(project: ProjectKey): boolean {
    for (const record of records.values()) {
      if (
        sameProject(record.opportunity.target.project, project) &&
        record.wayfinder?.status === 'outcome-unknown' &&
        !record.wayfinder.acknowledged
      ) {
        return true
      }
    }
    return false
  }

  async function reconcileWayfinders(): Promise<void> {
    for (const record of records.values()) {
      if (record.wayfinder?.status !== 'queued') continue
      if (projectHasUnacknowledgedInterruption(record.opportunity.target.project)) continue
      await beginDispatch(record.opportunity.target, 'automatic')
      if (!accepting || faulted) return
    }
  }

  async function reconcileClassification(): Promise<void> {
    for (const candidate of selectCandidates(resourcesNow())) {
      const result = await beginClassification(candidate.target, 'automatic')
      if (result.kind === 'admitted' || !accepting || faulted) return
    }
  }

  async function beginClassification(
    target: AutomationTarget,
    admission: AutomationAdmission,
  ): Promise<LaunchResult> {
    const initial = prepareLaunch(target, 'classification', admission)
    if (!initial.ok) return { kind: 'rejected', reason: initial.reason }
    const { candidate, command } = initial.prepared
    const opportunity: AutomationOpportunity = { id: randomUUID(), target }
    const startedEvent = {
      ...eventIdentity(opportunity.id),
      type: 'classification-started',
      admission,
    } satisfies AutomationEvent
    if (!(await append({ opportunities: [opportunity], events: [startedEvent] }))) {
      return { kind: 'persistence-failed' }
    }

    const current = prepareLaunch(target, 'classification', admission, opportunity.id)
    if (!current.ok || !samePreparedLaunch(initial.prepared, current.prepared)) {
      return settleNonlaunch(
        opportunity.id,
        'classification',
        current.ok ? 'Prepared launch dependencies changed.' : current.reason,
      )
    }
    let process: ClassificationProcess
    try {
      process = options.launcher.classify(launchRequest(candidate, command, 'classification'))
    } catch {
      const persisted = await append({
        events: [
          {
            ...eventIdentity(opportunity.id),
            type: 'classification-launch-failed',
            reason: 'The Classification Harness Command could not be launched.',
          },
        ],
      })
      return persisted ? { kind: 'admitted' } : { kind: 'persistence-failed' }
    }

    const launched: ActiveClassification = {
      candidate,
      opportunityId: opportunity.id,
      process,
      admission,
    }
    activeClassification = launched
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
    return { kind: 'admitted' }
  }

  async function finishClassification(
    launched: ActiveClassification,
    result: ClassificationProcessResult,
  ): Promise<void> {
    if (activeClassification !== launched) return
    activeClassification = null
    if (!accepting) return

    const classification = classificationResult(result, launched.admission)
    if (
      !(await append({ events: [classificationEvent(launched.opportunityId, classification)] }))
    ) {
      return
    }
    await reconcileNow()
  }

  async function beginDispatch(
    target: AutomationTarget,
    admission: AutomationAdmission,
  ): Promise<LaunchResult> {
    const initial = prepareLaunch(target, 'wayfinder', admission)
    if (!initial.ok) return { kind: 'rejected', reason: initial.reason }
    const record = records.get(automationTargetKey(target))
    if (!record) return { kind: 'rejected', reason: 'Run Classification first.' }
    if (
      !(await append({
        events: [
          {
            ...eventIdentity(record.opportunity.id),
            type: 'wayfinder-launching',
            admission,
          },
        ],
      }))
    )
      return { kind: 'persistence-failed' }

    const current = prepareLaunch(target, 'wayfinder', admission, record.opportunity.id)
    if (!current.ok || !samePreparedLaunch(initial.prepared, current.prepared)) {
      return settleNonlaunch(
        record.opportunity.id,
        'wayfinder',
        current.ok ? 'Prepared launch dependencies changed.' : current.reason,
      )
    }
    let dispatch: Promise<WayfinderProcess>
    try {
      dispatch = options.launcher.dispatch(
        launchRequest(initial.prepared.candidate, initial.prepared.command, 'wayfinder'),
      )
    } catch {
      await finishWayfinderLaunchFailure(target)
      return faulted ? { kind: 'persistence-failed' } : { kind: 'admitted' }
    }
    void dispatch.then(
      (process) => enqueue(() => markWayfinderRunning(target, process)),
      () => enqueue(() => finishWayfinderLaunchFailure(target)),
    )
    return { kind: 'admitted' }
  }

  async function settleNonlaunch(
    opportunityId: string,
    stage: AutomationOverrideStage,
    reason: string,
  ): Promise<LaunchResult> {
    const persisted = await append({
      events: [
        {
          ...eventIdentity(opportunityId),
          type:
            stage === 'classification' ? 'classification-launch-failed' : 'wayfinder-launch-failed',
          reason: `Admission changed before launch. No process was launched. ${reason}`,
        },
      ],
    })
    return persisted ? { kind: 'rejected', reason } : { kind: 'persistence-failed' }
  }

  function prepareLaunch(
    target: AutomationTarget,
    stage: AutomationOverrideStage,
    admission: AutomationAdmission,
    reservationId?: string,
  ): LaunchPreparation {
    if (!accepting) return { ok: false, reason: 'Roadmap is stopping.' }
    if (faulted) return { ok: false, reason: 'Automation evidence could not be persisted.' }
    const source = resourcesNow()
    if (!source?.committed.configurationValid)
      return { ok: false, reason: 'Current configuration cannot admit Automation.' }
    const pendingReason = pendingIneligibility(source, target, stage, admission)
    if (pendingReason) return { ok: false, reason: pendingReason }
    if (projectHasUnacknowledgedInterruption(target.project)) {
      return {
        ok: false,
        reason: 'A Wayfinder Session interruption must be acknowledged for this Project.',
      }
    }
    if (
      admission === 'automatic' &&
      !isEffectivelyEnabled(source.committed.registry, target.project)
    ) {
      return { ok: false, reason: 'Automatic Automation is disabled for this Project.' }
    }
    const resolved = resolveTarget(source, target)
    if (!resolved.ok) return resolved
    const policy = source.committed.registry.automation
    const command =
      stage === 'classification' ? policy.classificationCommand : policy.wayfinderCommand
    if (!command) return { ok: false, reason: 'Configure the stage Harness Command.' }
    const record = records.get(automationTargetKey(target))
    if (stage === 'classification') {
      if (admission === 'automatic') {
        const selected = selectCandidate(source, resolved.candidate.project)
        if (
          !policy.wayfinderCommand ||
          !selected ||
          automationTargetKey(selected.target) !== automationTargetKey(target)
        ) {
          return {
            ok: false,
            reason: 'This ticket is no longer the automatic Classification selection.',
          }
        }
      }
      if (reservationId) {
        if (
          record?.opportunity.id !== reservationId ||
          record.classification.status !== 'running' ||
          record.classification.admission !== admission
        ) {
          return {
            ok: false,
            reason: 'The Classification reservation is no longer owned by this admission.',
          }
        }
      } else if (record) {
        return { ok: false, reason: 'This Automation opportunity has already been classified.' }
      }
      if (
        activeClassification ||
        [...records.values()].some(
          (entry) =>
            entry.classification.status === 'running' && entry.opportunity.id !== reservationId,
        )
      ) {
        return { ok: false, reason: 'Another Classification Run is in progress.' }
      }
    } else {
      if (
        record?.classification.status !== 'completed' ||
        record.classification.verdict.value !== 'afk'
      ) {
        return { ok: false, reason: 'Classification did not produce an AFK Verdict.' }
      }
      if (reservationId) {
        if (
          record.opportunity.id !== reservationId ||
          record.wayfinder?.status !== 'launching' ||
          record.wayfinder.admission !== admission
        ) {
          return {
            ok: false,
            reason: 'The Wayfinder reservation is no longer owned by this admission.',
          }
        }
      } else if (record.wayfinder?.status !== 'queued') {
        return {
          ok: false,
          reason: 'A Wayfinder Session is already recorded for this opportunity.',
        }
      }
      if (projectHasActiveWayfinder(target.project, reservationId)) {
        return { ok: false, reason: 'Another Wayfinder Session is in progress for this Project.' }
      }
    }
    return { ok: true, prepared: { candidate: resolved.candidate, command } }
  }

  async function markWayfinderRunning(
    target: AutomationTarget,
    process: WayfinderProcess,
  ): Promise<void> {
    if (!accepting) return
    const current = records.get(automationTargetKey(target))
    if (current?.wayfinder?.status !== 'launching') return
    const launched = { target, process }
    activeWayfinders.set(projectKey(target.project), launched)
    void process.completed.then(
      (result) => enqueue(() => finishWayfinder(launched, result)),
      () =>
        enqueue(() =>
          finishWayfinderUnknown(launched, 'The Wayfinder Session process result was lost.'),
        ),
    )
    await append({
      events: [{ ...eventIdentity(current.opportunity.id), type: 'wayfinder-running' }],
    })
  }

  async function finishWayfinderLaunchFailure(target: AutomationTarget): Promise<void> {
    if (!accepting) return
    const current = records.get(automationTargetKey(target))
    if (current?.wayfinder?.status !== 'launching') return
    const persisted = await append({
      events: [
        {
          ...eventIdentity(current.opportunity.id),
          type: 'wayfinder-launch-failed',
          reason: 'The Wayfinder Session Command could not be launched.',
        },
      ],
    })
    if (persisted) await reconcileNow()
  }

  async function finishWayfinder(
    launched: ActiveWayfinder,
    result: WayfinderProcessResult,
  ): Promise<void> {
    if (!accepting || !isActiveWayfinder(launched)) return
    const current = records.get(automationTargetKey(launched.target))
    if (
      !current ||
      (current.wayfinder?.status !== 'launching' && current.wayfinder?.status !== 'running')
    ) {
      return
    }
    const persisted = await append({
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
    if (!persisted) return
    activeWayfinders.delete(projectKey(launched.target.project))
    await reconcileNow()
  }

  async function finishWayfinderUnknown(launched: ActiveWayfinder, reason: string): Promise<void> {
    if (!accepting || !isActiveWayfinder(launched)) return
    const current = records.get(automationTargetKey(launched.target))
    if (
      !current ||
      (current.wayfinder?.status !== 'launching' && current.wayfinder?.status !== 'running')
    ) {
      return
    }
    const persisted = await append({
      events: [
        {
          ...eventIdentity(current.opportunity.id),
          type: 'wayfinder-outcome-unknown',
          reason,
        },
      ],
    })
    if (!persisted) return
    activeWayfinders.delete(projectKey(launched.target.project))
    await reconcileNow()
  }

  function isActiveWayfinder(launched: ActiveWayfinder): boolean {
    return activeWayfinders.get(projectKey(launched.target.project)) === launched
  }

  function projectHasActiveWayfinder(project: ProjectKey, reservationId?: string): boolean {
    for (const record of records.values()) {
      if (
        sameProject(record.opportunity.target.project, project) &&
        record.opportunity.id !== reservationId &&
        (record.wayfinder?.status === 'launching' || record.wayfinder?.status === 'running')
      ) {
        return true
      }
    }
    return false
  }

  function overrideControls(): AutomationOverrideControl[] {
    const source = resourcesNow()
    if (!source) return []
    return source.projects.flatMap((project) =>
      project.maps.flatMap((map) =>
        map.tickets.map((ticket) => {
          const resolved = resolveCandidate(source, project, map, ticket)
          return {
            target: resolved.target,
            classification: overrideAvailability(
              'classification',
              resolved,
              source.committed.registry,
            ),
            wayfinder: overrideAvailability('wayfinder', resolved, source.committed.registry),
          }
        }),
      ),
    )
  }

  function overrideAvailability(
    stage: AutomationOverrideStage,
    resolved: CandidateResolution,
    configuration: Pick<ProjectConfiguration, 'automation'>,
  ): AutomationOverrideAvailability {
    const unavailable = commonOverrideIneligibility(resolved)
    if (unavailable) return unavailable
    const source = resourcesNow()
    if (!source) return ineligible('Current configuration cannot admit Automation.')
    const pendingReason = pendingIneligibility(source, resolved.target, stage, 'override')
    if (pendingReason) return ineligible(pendingReason)
    if (projectHasUnacknowledgedInterruption(resolved.target.project)) {
      return ineligible('A Wayfinder Session interruption must be acknowledged for this Project.')
    }
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
    if (!resourcesNow()?.committed.configurationValid)
      return ineligible('Current configuration cannot admit Automation.')
    return resolved.ok ? null : ineligible(resolved.reason)
  }

  function classificationOverrideAvailability(
    configuration: Pick<ProjectConfiguration, 'automation'>,
    record: AutomationRecord | undefined,
  ): AutomationOverrideAvailability {
    if (!configuration.automation.classificationCommand) {
      return ineligible('Configure the Classification Harness Command in roadmap.config.json.')
    }
    if (record) return ineligible('This Automation opportunity has already been classified.')
    if (
      activeClassification ||
      [...records.values()].some((entry) => entry.classification.status === 'running')
    ) {
      return ineligible('Another Classification Run is in progress.')
    }
    return { status: 'eligible' }
  }

  function wayfinderOverrideAvailability(
    configuration: Pick<ProjectConfiguration, 'automation'>,
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
    if (projectHasActiveWayfinder(record.opportunity.target.project)) {
      return ineligible('Another Wayfinder Session is in progress for this Project.')
    }
    return { status: 'eligible' }
  }

  function acknowledgeProjectInterruption(
    project: ProjectKey,
  ): Promise<{ ok: true } | { ok: false; error: SafeError }> {
    return enqueue(async () => {
      if (!accepting) {
        return { ok: false, error: overrideError('Roadmap is stopping.', 'not-supported') }
      }
      if (faulted) {
        return {
          ok: false,
          error: overrideError('Automation evidence could not be persisted.', 'persistence-failed'),
        }
      }
      const interruptions = [...records.values()].flatMap((record) => {
        const wayfinder = record.wayfinder
        if (
          !sameProject(record.opportunity.target.project, project) ||
          wayfinder?.status !== 'outcome-unknown' ||
          wayfinder.acknowledged
        ) {
          return []
        }
        return [
          {
            ...eventIdentity(record.opportunity.id),
            type: 'wayfinder-outcome-unknown-acknowledged',
            unknownEventId: wayfinder.eventId,
          } satisfies AutomationEvent,
        ]
      })
      if (interruptions.length === 0) return { ok: true }
      return (await append({ events: interruptions }))
        ? { ok: true }
        : {
            ok: false,
            error: overrideError(
              'Automation evidence could not be persisted.',
              'persistence-failed',
            ),
          }
    })
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
    const result =
      stage === 'classification'
        ? await beginClassification(target, 'override')
        : await beginDispatch(target, 'override')
    if (result.kind === 'admitted') {
      await reconcileNow()
      return { ok: true }
    }
    return {
      ok: false,
      error:
        result.kind === 'persistence-failed'
          ? overrideError('Automation evidence could not be persisted.', 'persistence-failed')
          : overrideError(result.reason),
    }
  }

  return {
    async start() {
      if (started) return
      install(await options.database.load())
      const recovery = interruptionEvents(records.values(), RESTART_UNKNOWN_REASON)
      if (recovery.length > 0 && !(await append({ events: recovery }))) return
      started = true
      await enqueue(reconcileNow)
    },
    evidence: () => currentEvidence.map(publicEvidence),
    overrides: () => overrideControls().map(publicOverride),
    interruptedProjects() {
      const projects = new Map<string, ProjectKey>()
      for (const record of records.values()) {
        const wayfinder = record.wayfinder
        const interrupted =
          (wayfinder?.status === 'outcome-unknown' && !wayfinder.acknowledged) ||
          ((faulted || !accepting) &&
            (wayfinder?.status === 'launching' || wayfinder?.status === 'running'))
        if (interrupted) {
          projects.set(
            projectKey(record.opportunity.target.project),
            record.opportunity.target.project,
          )
        }
      }
      return [...projects.values()]
    },
    acknowledgeProjectInterruption,
    startOverride,
    reconcile() {
      if (!started || !accepting) return
      void enqueue(reconcileNow)
    },
    async stop() {
      if (!accepting) return lane
      accepting = false
      const live = activeClassification
      if (live) await live.process.stop()
      await lane
      const interruptions = interruptionEvents(records.values(), STOP_UNKNOWN_REASON)
      if (interruptions.length > 0) await append({ events: interruptions })
      activeWayfinders.clear()
    },
  }
}

function samePreparedLaunch(before: PreparedLaunch, current: PreparedLaunch): boolean {
  const left = before.command
  const right = current.command
  return (
    before.candidate.sourceDependency === current.candidate.sourceDependency &&
    before.candidate.workspace === current.candidate.workspace &&
    before.candidate.mapPointer === current.candidate.mapPointer &&
    before.candidate.ticketPointer === current.candidate.ticketPointer &&
    sameCommand(left, right)
  )
}

function sameCommand(left: HarnessCommand | undefined, right: HarnessCommand | undefined): boolean {
  if (!left || !right) return left === right
  return (
    left.command === right.command &&
    left.promptDelivery === right.promptDelivery &&
    left.promptTemplate === right.promptTemplate &&
    left.args.length === right.args.length &&
    left.args.every((argument, index) => argument === right.args[index])
  )
}

function configurationDependency(
  configuration: ProjectConfiguration,
  project: ProjectKey,
): string | null {
  const intent = configuration.projects.find(
    (candidate) =>
      candidate.ref.integration === project.integration && candidate.ref.projectId === project.id,
  )
  if (!intent) return null
  const connection = configuration.connections.find(
    (candidate) => candidate.id === intent.connectionId,
  )
  return JSON.stringify([
    intent.ref.integration,
    intent.connectionId,
    intent.workspace.path,
    'gitIdentity' in intent.workspace ? intent.workspace.gitIdentity : null,
    'locator' in intent ? intent.locator.repositoryId : null,
    connection?.integration,
    connection?.integration === 'github' ? connection.githubIdentity.id : null,
  ])
}

function pendingIneligibility(
  source: ResourceCatalogSnapshot,
  target: AutomationTarget,
  stage: AutomationOverrideStage,
  admission: AutomationAdmission,
): string | null {
  const committed = source.committed
  if (!committed.pendingAdmission) return null
  if (committed.pendingConfigurations.length === 0)
    return 'Configuration admission is not confirmed.'
  const configuredDependency = configurationDependency(committed.registry, target.project)
  const currentCommand =
    stage === 'classification'
      ? committed.registry.automation.classificationCommand
      : committed.registry.automation.wayfinderCommand
  for (const pending of committed.pendingConfigurations) {
    if (
      configuredDependency === null ||
      configuredDependency !== configurationDependency(pending, target.project)
    ) {
      return 'The target Source or Workspace configuration is awaiting admission.'
    }
    const pendingCommand =
      stage === 'classification'
        ? pending.automation.classificationCommand
        : pending.automation.wayfinderCommand
    if (!sameCommand(currentCommand, pendingCommand))
      return 'The stage Harness Command is awaiting activation.'
    if (admission === 'automatic') {
      if (!isEffectivelyEnabled(pending, target.project))
        return 'Automatic Automation is disabled for this Project.'
      if (stage === 'classification' && !pending.automation.wayfinderCommand)
        return 'The Wayfinder Session Command is not configured.'
    }
  }
  return null
}

function publicEvidence(evidence: AutomationEvidence): PublicAutomationEvidence {
  const classification = evidence.classification
  const publicClassification: PublicAutomationEvidence['classification'] =
    classification.status === 'completed'
      ? {
          ...classification,
          processResult: { ...classification.processResult },
          verdict: { ...classification.verdict },
        }
      : classification.status === 'failed'
        ? { ...classification, processResult: { ...classification.processResult } }
        : { ...classification }
  const wayfinder = evidence.wayfinder
  const publicWayfinder: PublicAutomationEvidence['wayfinder'] =
    wayfinder?.status === 'finished'
      ? {
          ...wayfinder,
          processResult: { ...wayfinder.processResult },
          report:
            wayfinder.report.status === 'received'
              ? { status: 'received', report: { ...wayfinder.report.report } }
              : { ...wayfinder.report },
        }
      : wayfinder
        ? { ...wayfinder }
        : undefined
  return {
    target: {
      project: { ...evidence.target.project },
      mapId: evidence.target.mapId,
      ticketId: evidence.target.ticketId,
    },
    classification: publicClassification,
    ...(publicWayfinder ? { wayfinder: publicWayfinder } : {}),
  }
}

function publicOverride(control: AutomationOverrideControl): PublicAutomationOverrideControl {
  return {
    target: {
      project: { ...control.target.project },
      mapId: control.target.mapId,
      ticketId: control.target.ticketId,
    },
    classification: { ...control.classification },
    wayfinder: { ...control.wayfinder },
  }
}

function selectCandidates(source: ResourceCatalogSnapshot | null): Candidate[] {
  if (!source?.committed.configurationValid) return []
  const automation = source.committed.registry.automation
  if (!automation.enabled || !automation.classificationCommand || !automation.wayfinderCommand) {
    return []
  }
  return automation.enabledProjects.flatMap((enabled): Candidate[] => {
    const project = source.projects.find((entry) => sameProject(entry.key, enabled))
    const candidate = project ? selectCandidate(source, project) : null
    return candidate ? [candidate] : []
  })
}

function selectCandidate(
  source: ResourceCatalogSnapshot,
  project: CatalogProject,
): Candidate | null {
  if (project.activeMap.kind !== 'known-current') return null
  const mapId = project.activeMap.mapId
  const map = project.maps.find((entry) => entry.key.mapId === mapId)
  if (!map || map.ticketsMembership.kind !== 'current-complete') return null
  for (const member of map.ticketsMembership.observation.value.members) {
    const ticket = map.tickets.find((entry) => entry.key.ticketId === member.ticketId)
    if (!ticket || ticket.resource.kind !== 'current-readable') continue
    const value = ticket.resource.observation.value
    if (value.status !== 'open' || value.isClaimed) continue
    if (value.blockedBy.some((blocker) => blocker.state !== 'closed')) continue
    const resolved = resolveCandidate(source, project, map, ticket)
    return resolved.ok ? resolved.candidate : null
  }
  return null
}

function resolveTarget(
  source: ResourceCatalogSnapshot,
  target: AutomationTarget,
): CandidateResolution {
  if (!source.committed.configurationValid)
    return { ok: false, target, reason: 'Current configuration cannot admit Automation.' }
  const project = source.projects.find((candidate) => sameProject(candidate.key, target.project))
  if (!project) return { ok: false, target, reason: 'Project does not exist.' }
  const map = project.maps.find((candidate) => candidate.key.mapId === target.mapId)
  if (!map) return { ok: false, target, reason: 'Map does not exist.' }
  const ticket = map.tickets.find((candidate) => candidate.key.ticketId === target.ticketId)
  if (!ticket) return { ok: false, target, reason: 'Ticket does not exist.' }
  return resolveCandidate(source, project, map, ticket)
}

function resolveCandidate(
  source: ResourceCatalogSnapshot,
  project: CatalogProject,
  map: CatalogMap,
  ticket: CatalogTicket,
): CandidateResolution {
  const target = { project: project.key, mapId: map.key.mapId, ticketId: ticket.key.ticketId }
  const committed = source.committed
  const record = committed.registry.admissions.find(
    (entry) =>
      entry.intent.ref.integration === project.key.integration &&
      entry.intent.ref.projectId === project.key.id,
  )
  if (
    !record ||
    record.source.status !== 'ready' ||
    record.workspace.status !== 'admitted' ||
    (project.key.integration === 'github' &&
      committed.authorizationUsability.get(record.intent.connectionId)?.status !== 'usable') ||
    project.resource.kind !== 'current-readable' ||
    project.resource.observation.completeness.kind !== 'complete' ||
    project.mapsMembership.kind !== 'current-complete' ||
    project.activeMap.kind !== 'known-current'
  ) {
    return { ok: false, target, reason: 'Project is unavailable.' }
  }
  if (
    project.activeMap.mapId !== map.key.mapId ||
    !project.mapsMembership.observation.value.members.some(
      (member) => member.mapId === map.key.mapId,
    )
  ) {
    return { ok: false, target, reason: "Ticket is not on the Project's active map." }
  }
  if (
    map.resource.kind !== 'current-readable' ||
    map.resource.observation.completeness.kind !== 'complete' ||
    map.resource.observation.value.status !== 'open' ||
    map.ticketsMembership.kind !== 'current-complete'
  ) {
    return { ok: false, target, reason: "The active map's source evidence is incomplete." }
  }
  if (
    !map.ticketsMembership.observation.value.members.some(
      (member) => member.ticketId === ticket.key.ticketId,
    ) ||
    ticket.resource.kind !== 'current-readable' ||
    ticket.resource.observation.completeness.kind !== 'complete'
  ) {
    return { ok: false, target, reason: 'Ticket source evidence is unavailable.' }
  }
  const value = ticket.resource.observation.value
  const ineligibility = ticketIneligibility(value)
  if (ineligibility) return { ok: false, target, reason: ineligibility }
  const mapSource = map.resource.observation.value.source
  const ticketSource = value.source
  const mapPointer = mapSource.kind === 'file' ? mapSource.path : mapSource.url
  const ticketPointer = ticketSource.kind === 'file' ? ticketSource.path : ticketSource.url
  if (!mapPointer || !ticketPointer) {
    return { ok: false, target, reason: 'The Integration cannot provide map and ticket pointers.' }
  }
  const intent = record.intent
  const workspace = record.workspace.proof.path
  const sourceDependency =
    intent.ref.integration === 'local'
      ? JSON.stringify([
          'local',
          intent.connectionId,
          workspace,
          'gitIdentity' in intent.workspace ? intent.workspace.gitIdentity : null,
        ])
      : JSON.stringify([
          'github',
          intent.connectionId,
          'locator' in intent ? intent.locator.repositoryId : null,
          'accountId' in record.source.value ? record.source.value.accountId : null,
        ])
  return {
    ok: true,
    target,
    candidate: { target, mapPointer, ticketPointer, project, workspace, sourceDependency },
  }
}
function ticketIneligibility(ticket: SourceTicketContent): string | null {
  if (!ticket.blockersComplete) return 'Ticket blocker data is incomplete.'
  if (ticket.typeEvidence.kind !== 'recognized' || ticket.typeEvidence.value !== 'task') {
    return 'Only task tickets can use Automation.'
  }
  if (ticket.status === 'closed') return 'Ticket is already decided.'
  if (ticket.status === 'unknown') return 'Ticket status is unknown.'
  const blocked = ticket.blockedBy.some((blocker) => blocker.state !== 'closed')
  if (blocked && ticket.isClaimed) return 'Ticket is blocked and claimed.'
  if (blocked) return 'Ticket is blocked.'
  if (ticket.isClaimed) return 'Ticket is already claimed.'
  return null
}

function ineligible(reason: string): AutomationOverrideAvailability {
  return { status: 'ineligible', reason }
}

function overrideError(message: string, code: SafeError['code'] = 'validation'): SafeError {
  return { code, message, field: 'target' }
}

function isEffectivelyEnabled(
  configuration: Pick<ProjectConfiguration, 'automation'>,
  project: ProjectKey,
): boolean {
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
    workspace: candidate.workspace,
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

function interruptionEvents(
  records: Iterable<AutomationRecord>,
  reason: string,
): AutomationEvent[] {
  const events: AutomationEvent[] = []
  for (const record of records) {
    if (record.classification.status === 'running' && reason === RESTART_UNKNOWN_REASON) {
      events.push({
        ...eventIdentity(record.opportunity.id),
        type: 'classification-outcome-unknown',
        reason,
      })
    }
    if (record.wayfinder?.status === 'launching' || record.wayfinder?.status === 'running') {
      events.push({
        ...eventIdentity(record.opportunity.id),
        type: 'wayfinder-outcome-unknown',
        reason,
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
