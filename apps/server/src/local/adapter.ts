import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project, ProjectRegistration, Unreachable } from '@roadmap/contracts'
import type { AdapterHost, AdapterSlice, WayfinderAdapter } from '../store.ts'
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

interface RootStatusOk {
  ok: true
}

interface RootStatusMissing {
  ok: false
  reason: string
}

type RootStatus = RootStatusOk | RootStatusMissing

type LocalRegistration = ProjectRegistration & {
  key: { integration: 'local'; id: string }
  locator: { integration: 'local'; path: string }
}

type ReadProject = (input: LocalProjectInput) => Promise<Project>
type InspectRoot = (path: string) => Promise<RootStatus>
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
  registrations: readonly ProjectRegistration[]
  debounceMs?: number
  maxDebounceMs?: number
  reconcileMs?: number
  recoveryMs?: number
  maxRecoveryMs?: number
  readProject?: ReadProject
  inspectRoot?: InspectRoot
  pathExists?: PathExists
  watchDirectory?: WatchDirectory
  logger?: Logger
}

interface RegistrationState {
  registration: LocalRegistration
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
  const inspectRoot = options.inspectRoot ?? defaultInspectRoot
  const pathExists = options.pathExists ?? defaultPathExists
  const watchDirectory = options.watchDirectory ?? defaultWatchDirectory
  const logger = options.logger ?? console

  const states = new Map<string, RegistrationState>()
  const registrations = options.registrations.filter(isLocalRegistration)
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
      } catch (error) {
        logger.warn(`${label} failed; keeping the last good local slice`, error)
      }
    })
    chain = run
    return run
  }

  function stateFor(registration: LocalRegistration): RegistrationState {
    let state = states.get(registration.workspace.path)
    if (!state) {
      state = { registration, watcher: null, recoveryTimer: null, recoveryDelayMs: recoveryMs }
      states.set(registration.workspace.path, state)
    } else {
      state.registration = registration
    }
    return state
  }

  async function reconcile(reason: string): Promise<void> {
    return enqueue(`Local reconcile (${reason})`, async () => {
      const slice = await readSlice(registrations, readProject, inspectRoot)
      publish(slice)
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

      if (await pathExists(watchPathOf(state.registration))) {
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
    const [root, watcherPathLive] = await Promise.all([
      inspectRoot(state.registration.workspace.path),
      pathExists(watchPathOf(state.registration)),
    ])
    if (!root.ok || !watcherPathLive) scheduleRecovery(state)
    invalidate('watch')
  }

  function handleWatcherError(state: RegistrationState, error: Error): void {
    logger.warn(
      `Local watch failed for ${watchPathOf(state.registration)}; supervising re-attach`,
      error,
    )
    scheduleRecovery(state)
    invalidate('watch error')
  }

  async function attachWatcher(state: RegistrationState): Promise<void> {
    if (stopped) return
    clearRecovery(state)

    const path = watchPathOf(state.registration)
    if (!(await pathExists(path))) {
      scheduleRecovery(state)
      return
    }

    try {
      state.watcher = watchDirectory(
        path,
        () => void handleDirty(state),
        (error) => handleWatcherError(state, error),
      )
    } catch (error) {
      logger.warn(`Could not watch ${path}; supervising re-attach`, error)
      scheduleRecovery(state)
    }
  }

  return {
    type: 'local',
    async start(nextHost) {
      if (started) return
      started = true
      host = nextHost

      await Promise.all(registrations.map((registration) => attachWatcher(stateFor(registration))))
      await reconcile('baseline')
      scheduleReconcile()
      logger.info(
        `local baseline: ${registrations.length} registered project${registrations.length === 1 ? '' : 's'}`,
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

async function readSlice(
  registrations: readonly LocalRegistration[],
  readProject: ReadProject,
  inspectRoot: InspectRoot,
): Promise<AdapterSlice> {
  const entries = await Promise.all(
    registrations.map((registration) =>
      materializeRegistration(registration, readProject, inspectRoot),
    ),
  )
  return {
    projects: entries.flatMap((entry) => (entry.project ? [entry.project] : [])),
    unreachable: entries.flatMap((entry) => (entry.unreachable ? [entry.unreachable] : [])),
  }
}

async function materializeRegistration(
  registration: LocalRegistration,
  readProject: ReadProject,
  inspectRoot: InspectRoot,
): Promise<{ project: Project | null; unreachable: Unreachable | null }> {
  const rootPath = registration.workspace.path
  const root = await inspectRoot(rootPath)
  if (!root.ok) return { project: null, unreachable: toUnreachable(registration, root.reason) }

  try {
    const project = await readProject({
      key: registration.key,
      rootPath,
      name: registration.displayName ?? registration.key.id,
    })
    if (project.openMaps.length === 0 && project.closedMaps.length === 0) {
      const after = await inspectRoot(rootPath)
      if (!after.ok)
        return { project: null, unreachable: toUnreachable(registration, after.reason) }
    }
    return { project, unreachable: null }
  } catch (error) {
    const after = await inspectRoot(rootPath)
    const reason = after.ok
      ? `Could not read registered path ${JSON.stringify(rootPath)}: ${messageOf(error)}.`
      : after.reason
    return { project: null, unreachable: toUnreachable(registration, reason) }
  }
}

function toUnreachable(registration: LocalRegistration, reason: string): Unreachable {
  return {
    integration: 'local',
    project: registration.key,
    projectName: registration.displayName ?? registration.key.id,
    reason,
  }
}

function watchPathOf(registration: LocalRegistration): string {
  return join(registration.workspace.path, '.wayfinder')
}

async function defaultInspectRoot(path: string): Promise<RootStatus> {
  try {
    await stat(path)
    return { ok: true }
  } catch (error) {
    if (isMissing(error)) {
      return {
        ok: false,
        reason: `Registered path ${JSON.stringify(path)} does not exist right now.`,
      }
    }
    return {
      ok: false,
      reason: `Could not access registered path ${JSON.stringify(path)}: ${messageOf(error)}.`,
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
  const watcher = watch(path, { recursive: true }, () => onDirty())
  watcher.on('error', onError)
  return watcher
}

function isLocalRegistration(registration: ProjectRegistration): registration is LocalRegistration {
  return registration.key.integration === 'local' && registration.locator.integration === 'local'
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
