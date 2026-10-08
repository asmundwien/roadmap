import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AdapterHost,
  AdapterSlice,
  ObservationAttempt,
  SourceTicketKey,
  WayfinderAdapter,
} from '../observation/source.ts'
import { absentAttempt, failedAttempt, sourceScopeKey } from '../observation/source.ts'
import { type LocalProjectInput, readLocalProject } from '../wayfinder/from-local.ts'

/** How long a local adapter waits for a burst of filesystem noise to settle. */
const DEBOUNCE_MS = 250
/** A long edit burst still has to land eventually. */
const MAX_DEBOUNCE_MS = 2_000
/** The sweep under `fs.watch`: disk is truth, events are only the bell. */
const RECONCILE_MS = 5 * 60_000
/** When a watched tree vanishes, probe for its return with bounded backoff. */
const RECOVERY_MS = 2_000
const MAX_RECOVERY_MS = 10_000

type ReadProject = (input: LocalProjectInput) => Promise<AdapterSlice>
type PathExists = (path: string) => Promise<boolean>
type WatchDirectory = (
  path: string,
  onDirty: () => void,
  onError: (error: Error) => void,
) => WatchHandle

interface WatchHandle {
  close(): void
}

interface Logger {
  info(message: string): void
  warn(message: string, error?: unknown): void
}

export interface LocalAdapterOptions {
  sources: readonly LocalProjectInput[]
  debounceMs?: number
  maxDebounceMs?: number
  reconcileMs?: number
  recoveryMs?: number
  maxRecoveryMs?: number
  readProject?: ReadProject
  pathExists?: PathExists
  watchDirectory?: WatchDirectory
  logger?: Logger
}

interface RegistrationState {
  source: LocalProjectInput
  watcher: WatchHandle | null
  recoveryTimer: ReturnType<typeof setTimeout> | null
  recoveryDelayMs: number
}

export function createLocalAdapter(options: LocalAdapterOptions): WayfinderAdapter {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const maxDebounceMs = options.maxDebounceMs ?? MAX_DEBOUNCE_MS
  const reconcileMs = options.reconcileMs ?? RECONCILE_MS
  const recoveryMs = options.recoveryMs ?? RECOVERY_MS
  const maxRecoveryMs = options.maxRecoveryMs ?? MAX_RECOVERY_MS
  const readProject = options.readProject ?? readLocalProject
  const pathExists = options.pathExists ?? defaultPathExists
  const watchDirectory = options.watchDirectory ?? defaultWatchDirectory
  const logger = options.logger ?? console

  const states = new Map<string, RegistrationState>()
  const sources = options.sources
  const latest = new Map<string, ObservationAttempt>()
  const knownTickets = new Map<string, { key: SourceTicketKey; path: string }>()
  let host: AdapterHost | null = null
  let stopped = false
  let started = false
  let sliceFingerprint = ''
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let debounceStartedAt = 0

  let chain: Promise<void> = Promise.resolve()

  function publish(slice: AdapterSlice): void {
    if (host === null || stopped) return
    const next = JSON.stringify(slice)
    if (next === sliceFingerprint) return
    sliceFingerprint = next
    host.update(slice)
  }

  function enqueue(label: string, op: () => Promise<void>): Promise<void> {
    const run = chain.then(async () => {
      if (stopped) return
      try {
        await op()
      } catch {
        logger.warn(`${label} failed; keeping the prior local evidence`)
      }
    })
    chain = run
    return run
  }

  function stateFor(source: LocalProjectInput): RegistrationState {
    let state = states.get(source.rootPath)
    if (!state) {
      state = { source, watcher: null, recoveryTimer: null, recoveryDelayMs: recoveryMs }
      states.set(source.rootPath, state)
    } else {
      state.source = source
    }
    return state
  }

  async function reconcile(reason: string): Promise<void> {
    return enqueue(`Local reconcile (${reason})`, async () => {
      const slices = await Promise.all(
        sources.map(async (source): Promise<AdapterSlice> => {
          const attemptedAt = Date.now()
          const priorTickets = [...knownTickets.values()].filter(
            (ticket) =>
              ticket.key.map.project.integration === source.key.integration &&
              ticket.key.map.project.id === source.key.id,
          )
          try {
            return await readProject({ ...source, knownTickets: priorTickets })
          } catch (error) {
            const code =
              typeof error === 'object' && error !== null && 'code' in error
                ? error.code
                : undefined
            return {
              attempts: [
                failedAttempt({
                  kind: 'failed',
                  scope: { kind: 'project', project: source.key },
                  attemptedAt,
                  provenance: { integration: 'local', path: source.rootPath, operation: 'read' },
                  failure: {
                    kind: 'filesystem',
                    operation: 'read',
                    code: code === 'ENOENT' || code === 'EACCES' ? code : 'other',
                  },
                }),
              ],
            }
          }
        }),
      )
      const attempts = slices.flatMap((slice) => slice.attempts)
      for (const attempt of attempts) {
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
        if (attempt.kind === 'proven-absent') {
          knownTickets.delete(key)
        }
      }
      publish({ attempts: [...new Set(latest.values())] })
    })
  }

  function scheduleReconcile(): void {
    if (stopped) return
    reconcileTimer = setTimeout(async () => {
      await reconcile('interval')
      scheduleReconcile()
    }, reconcileMs)
  }

  function invalidate(reason: string): void {
    if (stopped) return
    const now = Date.now()
    if (debounceTimer === null) debounceStartedAt = now
    else clearTimeout(debounceTimer)

    const elapsed = now - debounceStartedAt
    const delay = elapsed >= maxDebounceMs ? 0 : Math.min(debounceMs, maxDebounceMs - elapsed)
    debounceTimer = setTimeout(() => flush(reason), delay)
  }

  function flush(reason: string): void {
    debounceTimer = null
    debounceStartedAt = 0
    void reconcile(reason)
  }

  function clearRecovery(state: RegistrationState): void {
    if (state.recoveryTimer !== null) {
      clearTimeout(state.recoveryTimer)
      state.recoveryTimer = null
    }
    state.recoveryDelayMs = recoveryMs
  }

  function closeWatcher(state: RegistrationState): void {
    state.watcher?.close()
    state.watcher = null
  }

  function scheduleRecovery(state: RegistrationState): void {
    if (stopped) return
    closeWatcher(state)
    if (state.recoveryTimer !== null) return

    state.recoveryTimer = setTimeout(async () => {
      state.recoveryTimer = null
      if (stopped) return

      if (await pathExists(watchPathOf(state.source))) {
        state.recoveryDelayMs = recoveryMs
        await attachWatcher(state)
        invalidate('recovery')
        return
      }

      state.recoveryDelayMs = Math.min(state.recoveryDelayMs * 2, maxRecoveryMs)
      scheduleRecovery(state)
    }, state.recoveryDelayMs)
  }

  async function handleDirty(state: RegistrationState): Promise<void> {
    if (!(await pathExists(watchPathOf(state.source)))) scheduleRecovery(state)
    invalidate('watch')
  }

  function handleWatcherError(state: RegistrationState): void {
    logger.warn(`Local watch failed for ${watchPathOf(state.source)}; supervising re-attach`)
    scheduleRecovery(state)
    invalidate('watch error')
  }

  async function attachWatcher(state: RegistrationState): Promise<void> {
    if (stopped) return
    clearRecovery(state)

    const path = watchPathOf(state.source)
    if (!(await pathExists(path))) {
      scheduleRecovery(state)
      return
    }

    try {
      state.watcher = watchDirectory(
        path,
        () => void handleDirty(state),
        () => handleWatcherError(state),
      )
    } catch {
      logger.warn(`Could not watch ${path}; supervising re-attach`)
      scheduleRecovery(state)
    }
  }

  return {
    type: 'local',
    async start(nextHost) {
      if (started) return
      started = true
      host = nextHost

      await Promise.all(sources.map((source) => attachWatcher(stateFor(source))))
      await reconcile('baseline')
      scheduleReconcile()
      logger.info(
        `local baseline: ${sources.length} registered project${sources.length === 1 ? '' : 's'}`,
      )
    },
    async stop() {
      stopped = true
      if (reconcileTimer !== null) clearTimeout(reconcileTimer)
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      for (const state of states.values()) {
        closeWatcher(state)
        if (state.recoveryTimer !== null) clearTimeout(state.recoveryTimer)
        state.recoveryTimer = null
      }
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
          attemptedAt: attempt.attemptedAt,
          observedAt: attempt.observedAt,
          provenance: attempt.provenance,
          proof: { kind: 'complete-membership', parent },
        }),
      )
    }
  }
}

function watchPathOf(source: LocalProjectInput): string {
  return join(source.rootPath, '.wayfinder')
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
  const watcher = watch(path, { recursive: true }, () => onDirty())
  watcher.on('error', onError)
  return watcher
}
