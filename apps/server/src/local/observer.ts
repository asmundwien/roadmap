import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalObservationInput } from '../observation/coordinator.ts'
import type {
  ObservationAttempt,
  ObservationBatch,
  SourceContribution,
  SourceObservationHealth,
  SourceObserver,
  SourceTicketKey,
} from '../observation/source.ts'
import {
  absentAttempt,
  createReadSequenceAllocator,
  failedAttempt,
  sourceScopeKey,
} from '../observation/source.ts'
import { type LocalProjectReadOptions, readLocalProject } from '../wayfinder/from-local.ts'

const DEBOUNCE_MS = 250
const MAX_DEBOUNCE_MS = 2_000
const RECONCILE_MS = 5 * 60_000
const RECOVERY_MS = 2_000
const MAX_RECOVERY_MS = 10_000

type ReadProject = (
  input: LocalObservationInput,
  options: LocalProjectReadOptions,
) => Promise<ObservationBatch>

interface WatchHandle {
  close(): void
}

export interface LocalObserverOptions {
  debounceMs?: number
  maxDebounceMs?: number
  reconcileMs?: number
  recoveryMs?: number
  maxRecoveryMs?: number
  readProject?: ReadProject
  pathExists?: (path: string) => Promise<boolean>
  watchDirectory?: (
    path: string,
    onDirty: () => void,
    onError: (error: Error) => void,
  ) => WatchHandle
  now?: () => number
  logger?: {
    info(message: string): void
    warn(message: string, error?: unknown): void
  }
}

/** Owns one admitted Local source, its retained scope evidence and filesystem supervision. */
export function createLocalObserver(
  input: LocalObservationInput,
  options: LocalObserverOptions = {},
): SourceObserver {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const maxDebounceMs = options.maxDebounceMs ?? MAX_DEBOUNCE_MS
  const reconcileMs = options.reconcileMs ?? RECONCILE_MS
  const recoveryMs = options.recoveryMs ?? RECOVERY_MS
  const maxRecoveryMs = options.maxRecoveryMs ?? MAX_RECOVERY_MS
  const readProject = options.readProject ?? readLocalProject
  const pathExists = options.pathExists ?? defaultPathExists
  const watchDirectory = options.watchDirectory ?? defaultWatchDirectory
  const now = options.now ?? Date.now
  const nextReadSequence = createReadSequenceAllocator()
  const logger = options.logger ?? console
  const project = { integration: input.ref.integration, id: input.ref.projectId }
  const watchPath = join(input.workspace.path, '.wayfinder')
  const latest = new Map<string, ObservationAttempt>()
  const knownTickets = new Map<string, { key: SourceTicketKey; path: string }>()
  const listeners = new Set<(value: SourceContribution) => void>()
  let watcher: WatchHandle | null = null
  let stopped = false
  let stopPromise: Promise<void> | null = null
  const tasks = new Set<Promise<void>>()
  const disposalFailures: unknown[] = []
  let baseline: Promise<SourceContribution> | null = null
  let contributionFingerprint = ''
  let lastSuccessfulAt: number | undefined
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null
  let recoveryDelayMs = recoveryMs
  let debounceStartedAt = 0
  let chain: Promise<void> = Promise.resolve()

  function run<T>(operation: () => Promise<T>): Promise<T> {
    const result = Promise.resolve().then(operation)
    const completion = result.then(
      () => undefined,
      () => undefined,
    )
    tasks.add(completion)
    void completion.then(() => tasks.delete(completion))
    return result
  }

  function background(operation: () => Promise<void>, reason: string): void {
    if (stopped) return
    void run(operation).catch((error: unknown) => {
      if (!stopped) logger.warn(`Local supervision (${reason}) failed`, error)
    })
  }

  function publish(contribution: SourceContribution): void {
    if (stopped) return
    const fingerprint = JSON.stringify(contribution)
    if (fingerprint === contributionFingerprint) return
    contributionFingerprint = fingerprint
    for (const listener of listeners) {
      if (stopped) break
      listener(contribution)
    }
  }

  function healthFor(batch: ObservationBatch): SourceObservationHealth {
    const root = batch.attempts.find(
      (attempt) => attempt.scope.kind === 'project' && attempt.kind === 'observed',
    )
    if (root?.kind === 'observed') {
      lastSuccessfulAt = root.observedAt
      const incomplete = batch.attempts.some(
        (attempt) =>
          attempt.kind === 'failed' ||
          (attempt.kind === 'observed' && attempt.completeness.kind === 'incomplete'),
      )
      return incomplete
        ? {
            status: 'degraded',
            cause: 'Some Local source scopes could not be read completely.',
            observedAt: root.observedAt,
          }
        : { status: 'available', observedAt: root.observedAt }
    }
    return {
      status: 'unavailable',
      cause: 'The Local source folder could not be read.',
      ...(lastSuccessfulAt === undefined ? {} : { observedAt: lastSuccessfulAt }),
    }
  }

  function reconcile(): Promise<SourceContribution> {
    const run = chain.then(async () => {
      if (stopped) throw new Error('The Local observer has stopped.')
      const attemptedAt = now()
      let batch: ObservationBatch
      try {
        batch = await readProject(input, {
          knownTickets: [...knownTickets.values()],
          now,
          nextReadSequence,
        })
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
        batch = {
          attempts: [
            failedAttempt({
              kind: 'failed',
              scope: { kind: 'project', project },
              readSequence: nextReadSequence(),
              attemptedAt,
              provenance: {
                integration: 'local',
                path: input.workspace.path,
                operation: 'read',
              },
              failure: {
                kind: 'filesystem',
                operation: 'read',
                code: code === 'ENOENT' || code === 'EACCES' ? code : 'other',
              },
            }),
          ],
        }
      }
      for (const attempt of batch.attempts) {
        const key = sourceScopeKey(attempt.scope)
        if (attempt.kind === 'observed' && attempt.scope.kind === 'tickets-membership') {
          for (const storedKey of latest.keys()) {
            if (storedKey.startsWith(`${key}|file:`)) latest.delete(storedKey)
          }
        }
        proveOmittedMembers(attempt, latest)
        latest.set(key, attempt)
        if (
          attempt.kind === 'failed' &&
          attempt.scope.kind === 'tickets-membership' &&
          attempt.provenance.integration === 'local' &&
          attempt.provenance.operation === 'read'
        ) {
          latest.set(`${key}|file:${attempt.provenance.path}`, attempt)
        }
        if (
          attempt.kind === 'observed' &&
          attempt.scope.kind === 'ticket' &&
          'source' in attempt.value &&
          'kind' in attempt.value.source &&
          attempt.value.source.kind === 'file'
        ) {
          knownTickets.set(sourceScopeKey(attempt.scope), {
            key: attempt.scope.ticket,
            path: attempt.value.source.path,
          })
        }
      }
      for (const [key, attempt] of latest) {
        if (attempt.kind === 'proven-absent') knownTickets.delete(key)
      }
      const contribution: SourceContribution = {
        project,
        attempts: [...new Set(latest.values())],
        health: healthFor(batch),
      }
      publish(contribution)
      return contribution
    })
    chain = run.then(
      () => {},
      () => {},
    )
    return run
  }

  function backgroundReconcile(reason: string): Promise<void> {
    return reconcile().then(
      () => {},
      () => {
        if (!stopped) logger.warn(`Local reconcile (${reason}) failed; keeping prior evidence`)
      },
    )
  }

  function scheduleReconcile(): void {
    if (stopped) return
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null
      background(async () => {
        await backgroundReconcile('interval')
        scheduleReconcile()
      }, 'interval')
    }, reconcileMs)
  }

  function invalidate(reason: string): void {
    if (stopped) return
    const invalidatedAt = now()
    if (debounceTimer === null) debounceStartedAt = invalidatedAt
    clearTimeout(debounceTimer ?? undefined)
    const elapsed = invalidatedAt - debounceStartedAt
    const delay = elapsed >= maxDebounceMs ? 0 : Math.min(debounceMs, maxDebounceMs - elapsed)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      debounceStartedAt = 0
      background(() => backgroundReconcile(reason), reason)
    }, delay)
  }

  function closeWatcher(): void {
    const closing = watcher
    watcher = null
    try {
      closing?.close()
    } catch (error) {
      disposalFailures.push(error)
    }
  }

  function scheduleRecovery(): void {
    if (stopped) return
    closeWatcher()
    if (recoveryTimer !== null) return
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null
      background(async () => {
        if (stopped) return
        const exists = await pathExists(watchPath)
        if (stopped) return
        if (exists) {
          recoveryDelayMs = recoveryMs
          await attachWatcher()
          invalidate('recovery')
          return
        }
        recoveryDelayMs = Math.min(recoveryDelayMs * 2, maxRecoveryMs)
        scheduleRecovery()
      }, 'recovery')
    }, recoveryDelayMs)
  }

  async function handleDirty(): Promise<void> {
    if (stopped) return
    const exists = await pathExists(watchPath)
    if (stopped) return
    if (!exists) scheduleRecovery()
    invalidate('watch')
  }

  function handleWatcherError(): void {
    if (stopped) return
    logger.warn(`Local watch failed for ${watchPath}; supervising re-attach`)
    scheduleRecovery()
    invalidate('watch error')
  }

  async function attachWatcher(): Promise<void> {
    if (stopped || watcher) return
    clearTimeout(recoveryTimer ?? undefined)
    recoveryTimer = null
    recoveryDelayMs = recoveryMs
    if (!(await pathExists(watchPath))) {
      scheduleRecovery()
      return
    }
    if (stopped || watcher) return
    try {
      watcher = watchDirectory(
        watchPath,
        () => background(handleDirty, 'watch'),
        handleWatcherError,
      )
    } catch {
      logger.warn(`Could not watch ${watchPath}; supervising re-attach`)
      scheduleRecovery()
    }
  }

  function observe(): Promise<SourceContribution> {
    if (stopped) return Promise.reject(new Error('The Local observer has stopped.'))
    if (baseline !== null) return baseline
    baseline = run(async () => {
      if (stopped) throw new Error('The Local observer has stopped.')
      await attachWatcher()
      const contribution = await reconcile()
      if (!stopped) {
        scheduleReconcile()
        logger.info('local baseline: 1 registered project')
      }
      return contribution
    })
    return baseline
  }

  return {
    observe,
    subscribe(listener) {
      if (stopped) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh() {
      if (stopped) return Promise.reject(new Error('The Local observer has stopped.'))
      return run(() => (baseline === null ? observe() : baseline.then(() => reconcile())))
    },
    stop() {
      if (stopPromise) return stopPromise
      stopped = true
      clearTimeout(reconcileTimer ?? undefined)
      clearTimeout(debounceTimer ?? undefined)
      clearTimeout(recoveryTimer ?? undefined)
      closeWatcher()
      listeners.clear()
      stopPromise = Promise.all([...tasks]).then(async () => {
        await chain
        if (disposalFailures.length === 1) throw disposalFailures[0]
        if (disposalFailures.length > 1)
          throw new AggregateError(disposalFailures, 'Local watcher disposal failed.')
      })
      return stopPromise
    },
  }
}

function proveOmittedMembers(
  attempt: ObservationAttempt,
  latest: Map<string, ObservationAttempt>,
): void {
  if (attempt.kind !== 'observed' || attempt.completeness.kind !== 'complete') return
  if (attempt.scope.kind === 'maps-membership' && 'members' in attempt.value) {
    const parent = attempt.scope
    const members = new Set(
      attempt.value.members.flatMap((key) =>
        'mapId' in key ? [sourceScopeKey({ kind: 'map', map: key })] : [],
      ),
    )
    for (const prior of latest.values()) {
      if (
        prior.scope.kind !== 'map' ||
        prior.scope.map.project.integration !== parent.project.integration ||
        prior.scope.map.project.id !== parent.project.id ||
        members.has(sourceScopeKey(prior.scope))
      )
        continue
      latest.set(
        sourceScopeKey(prior.scope),
        absentAttempt({
          kind: 'proven-absent',
          scope: prior.scope,
          readSequence: attempt.readSequence,
          attemptedAt: attempt.attemptedAt,
          observedAt: attempt.observedAt,
          provenance: attempt.provenance,
          proof: { kind: 'complete-membership', parent },
        }),
      )
    }
  } else if (attempt.scope.kind === 'tickets-membership' && 'members' in attempt.value) {
    const parent = attempt.scope
    const members = new Set(
      attempt.value.members.flatMap((key) =>
        'ticketId' in key ? [sourceScopeKey({ kind: 'ticket', ticket: key })] : [],
      ),
    )
    for (const prior of latest.values()) {
      if (
        prior.scope.kind !== 'ticket' ||
        prior.scope.ticket.map.mapId !== parent.map.mapId ||
        prior.scope.ticket.map.project.integration !== parent.map.project.integration ||
        prior.scope.ticket.map.project.id !== parent.map.project.id ||
        members.has(sourceScopeKey(prior.scope))
      )
        continue
      latest.set(
        sourceScopeKey(prior.scope),
        absentAttempt({
          kind: 'proven-absent',
          scope: prior.scope,
          readSequence: attempt.readSequence,
          attemptedAt: attempt.attemptedAt,
          observedAt: attempt.observedAt,
          provenance: attempt.provenance,
          proof: { kind: 'complete-membership', parent },
        }),
      )
    }
  }
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function defaultWatchDirectory(
  path: string,
  onDirty: () => void,
  onError: (error: Error) => void,
): WatchHandle {
  const watcher = watch(path, { recursive: true }, onDirty)
  watcher.on('error', onError)
  return watcher
}
