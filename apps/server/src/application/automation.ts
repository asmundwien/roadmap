import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ProjectKey, RegisteredProject, Ticket } from '@roadmap/contracts'
import { isRecord } from '../type-guards.ts'
import type { HarnessCommand, RoadmapConfiguration } from './configuration.ts'

const PROMPT_MARKER = '{{roadmap.prompt}}'
const STDOUT_LIMIT = 16 * 1024
const STDERR_LIMIT = 64 * 1024
const PROMPT_VERSION = 1

type ClassificationVerdict = 'afk' | 'hitl' | 'unable'

interface AutomationTarget {
  project: ProjectKey
  mapId: string
  ticketId: string
}

type ClassificationAttempt =
  | { status: 'attempted' }
  | { status: ClassificationVerdict | 'failed'; reason: string }

type WayfinderAttempt = { status: 'attempted' | 'started' | 'launch-failed' }

interface AutomationRecord {
  target: AutomationTarget
  classification: ClassificationAttempt
  wayfinder?: WayfinderAttempt
}

export type AutomationLedgerRecord = AutomationRecord

interface AutomationStore {
  schemaVersion: 1
  records: AutomationRecord[]
}

export interface AutomationDocument {
  load(): Promise<AutomationRecord[]>
  write(records: readonly AutomationRecord[]): Promise<void>
}

export interface ClassificationProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stdoutOversized: boolean
  launchError?: string
}

export interface ClassificationProcess {
  completed: Promise<ClassificationProcessResult>
  stop(): Promise<void>
}

export interface AutomationLaunch {
  command: HarnessCommand
  workspace: string
  prompt: string
  environment: Record<string, string>
}

export interface AutomationLauncher {
  classify(request: AutomationLaunch): ClassificationProcess
  dispatch(request: AutomationLaunch): Promise<void>
}

interface AutomationSource {
  configuration: RoadmapConfiguration
  projects: readonly RegisteredProject[]
}

export interface AutomationLoop {
  start(): Promise<void>
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
}

export function createAutomationLoop(options: {
  document: AutomationDocument
  launcher: AutomationLauncher
  source(): AutomationSource
}): AutomationLoop {
  let records = new Map<string, AutomationRecord>()
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

  async function persist(next: Map<string, AutomationRecord>): Promise<boolean> {
    try {
      await options.document.write([...next.values()])
      records = next
      return true
    } catch {
      faulted = true
      return false
    }
  }

  async function replace(record: AutomationRecord): Promise<boolean> {
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
      await beginClassification(candidate, configuration.automation.classificationCommand)
      return false
    }
    if (record.classification.status !== 'afk' || record.wayfinder) return true
    await beginDispatch(candidate, record, configuration.automation.wayfinderCommand)
    return !faulted
  }

  async function beginClassification(
    candidate: Candidate,
    command: HarnessCommand | undefined,
  ): Promise<void> {
    if (!command) return
    const marker: AutomationRecord = {
      target: candidate.target,
      classification: { status: 'attempted' },
    }
    if (!(await replace(marker)) || !accepting) return

    let process: ClassificationProcess
    try {
      process = options.launcher.classify(launchRequest(candidate, command, 'classification'))
    } catch {
      await replace({
        ...marker,
        classification: {
          status: 'failed',
          reason: 'The Classification Harness Command could not be launched.',
        },
      })
      await reconcileNow()
      return
    }

    const launched: ActiveClassification = { candidate, process }
    active = launched
    void process.completed.then(
      (result) => enqueue(() => finishClassification(launched, result)),
      () =>
        enqueue(() =>
          finishClassification(launched, {
            code: null,
            signal: null,
            stdout: '',
            stdoutOversized: false,
            launchError: 'The Classification process result was lost.',
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

    const record: AutomationRecord = {
      target: launched.candidate.target,
      classification: classificationResult(result),
    }
    if (!(await replace(record))) return

    const source = options.source()
    if (
      record.classification.status === 'afk' &&
      isEffectivelyEnabled(source.configuration, launched.candidate.target.project)
    ) {
      await beginDispatch(
        launched.candidate,
        record,
        source.configuration.automation.wayfinderCommand,
      )
    }
    await reconcileNow()
  }

  async function beginDispatch(
    candidate: Candidate,
    record: AutomationRecord,
    command: HarnessCommand | undefined,
  ): Promise<void> {
    if (!command || record.wayfinder) return
    const marker: AutomationRecord = { ...record, wayfinder: { status: 'attempted' } }
    if (!(await replace(marker)) || !accepting) return

    try {
      await options.launcher.dispatch(launchRequest(candidate, command, 'wayfinder'))
      await replace({ ...marker, wayfinder: { status: 'started' } })
    } catch {
      await replace({ ...marker, wayfinder: { status: 'launch-failed' } })
    }
  }

  return {
    async start() {
      if (started) return
      const loaded = await options.document.load()
      records = new Map(loaded.map((record) => [targetKey(record.target), record]))
      started = true
      await enqueue(reconcileNow)
    },
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
}

function classificationResult(result: ClassificationProcessResult): ClassificationAttempt {
  if (result.launchError) return { status: 'failed', reason: result.launchError }
  if (result.signal || result.code !== 0) {
    const detail = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.code ?? 'unknown'}`
    return { status: 'failed', reason: `Classification process failed with ${detail}.` }
  }
  if (result.stdoutOversized) {
    return { status: 'failed', reason: `Classification stdout exceeded ${STDOUT_LIMIT} bytes.` }
  }
  const decoded = decodeHarnessVerdict(result.stdout)
  return (
    decoded ?? {
      status: 'failed',
      reason: 'Classification stdout was not one valid version 1 verdict object.',
    }
  )
}

function decodeHarnessVerdict(stdout: string): ClassificationAttempt | null {
  let input: unknown
  try {
    input = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!isRecord(input) || !exactKeys(input, ['schemaVersion', 'verdict', 'reason'])) return null
  if (input.schemaVersion !== PROMPT_VERSION) return null
  if (input.verdict !== 'afk' && input.verdict !== 'hitl' && input.verdict !== 'unable') return null
  if (typeof input.reason !== 'string' || input.reason.length === 0 || input.reason.length > 1000) {
    return null
  }
  return { status: input.verdict, reason: input.reason }
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
      return decodeStore(input)
    },
    async write(records) {
      const store: AutomationStore = { schemaVersion: 1, records: [...records] }
      await atomicWrite(path, `${JSON.stringify(store, null, 2)}\n`)
    },
  }
}

function decodeStore(input: unknown): AutomationRecord[] {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['schemaVersion', 'records']) ||
    input.schemaVersion !== 1 ||
    !Array.isArray(input.records)
  ) {
    throw new Error('The Automation ledger has an unsupported shape.')
  }
  const records = input.records.map(decodeRecord)
  const targets = new Set<string>()
  for (const record of records) {
    const key = targetKey(record.target)
    if (targets.has(key)) throw new Error('The Automation ledger repeats a ticket identity.')
    targets.add(key)
  }
  return records
}

function decodeRecord(input: unknown): AutomationRecord {
  if (!isRecord(input) || !exactKeys(input, ['target', 'classification', 'wayfinder'])) {
    throw new Error('An Automation record has an unsupported shape.')
  }
  const classification = decodeClassificationAttempt(input.classification)
  const wayfinder =
    input.wayfinder === undefined ? undefined : decodeWayfinderAttempt(input.wayfinder)
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

function decodeWayfinderAttempt(input: unknown): WayfinderAttempt {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['status']) ||
    (input.status !== 'attempted' && input.status !== 'started' && input.status !== 'launch-failed')
  ) {
    throw new Error('An Automation Wayfinder attempt is invalid.')
  }
  return { status: input.status }
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
      let launchError: string | undefined
      let closed = false
      const { promise: completed, resolve } = Promise.withResolvers<ClassificationProcessResult>()
      child.once('error', (error) => {
        launchError = processError(error, 'Classification Harness Command')
      })
      child.once('close', (code, signal) => {
        closed = true
        resolve({
          code,
          signal,
          stdout: stdout.text(),
          stdoutOversized: stdout.truncated(),
          ...(launchError ? { launchError } : {}),
        })
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
      const { promise, resolve, reject } = Promise.withResolvers<void>()
      const child = spawnCommand(request, ['ignore', 'ignore'])
      child.once('error', (error) =>
        reject(new Error(processError(error, 'Wayfinder Session Command'))),
      )
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
      deliverStdin(child, request)
      return promise
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
