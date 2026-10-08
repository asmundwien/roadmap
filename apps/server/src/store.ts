import type {
  AdapterHost,
  AdapterSlice,
  SourceIntegration,
  SourceSnapshot,
  WayfinderAdapter,
} from './observation/source.ts'
import { refineObservationAttempt, sourceScopeKey } from './observation/source.ts'

export interface SnapshotStore {
  /** Empty until every adapter baseline lands. */
  snapshot(): SourceSnapshot
  onChange(listener: (snapshot: SourceSnapshot) => void): () => void
  start(): Promise<void>
  stop(): Promise<void>
}

export function createSnapshotStore(adapters: readonly WayfinderAdapter[]): SnapshotStore {
  if (new Set(adapters.map((adapter) => adapter.type)).size !== adapters.length) {
    throw new Error('createSnapshotStore requires one adapter per Integration')
  }
  const slices = new Map<SourceIntegration, AdapterSlice>()
  let current: SourceSnapshot = { capturedAt: 0, attempts: [] }
  let fingerprint = ''
  const listeners = new Set<(snapshot: SourceSnapshot) => void>()
  let stopped = false
  let startPromise: Promise<void> | null = null

  function publish(): void {
    if (stopped || slices.size !== adapters.length) return
    const attempts = adapters.flatMap((adapter) => slices.get(adapter.type)?.attempts ?? [])
    const next = JSON.stringify(attempts)
    if (next === fingerprint) return
    fingerprint = next
    current = { capturedAt: Date.now(), attempts }
    for (const listener of listeners) {
      if (stopped) break
      listener(current)
    }
  }

  function hostFor(adapter: WayfinderAdapter): AdapterHost {
    return {
      update(slice) {
        if (stopped) return
        const scopes = new Set<string>()
        for (const input of slice.attempts) {
          const attempt = refineObservationAttempt(input)
          if (
            !attempt ||
            attempt.provenance.integration !== adapter.type ||
            scopes.has(sourceScopeKey(attempt.scope))
          ) {
            console.warn(`${adapter.type} adapter published invalid source evidence.`)
            return
          }
          scopes.add(sourceScopeKey(attempt.scope))
        }
        slices.set(adapter.type, slice)
        publish()
      },
    }
  }

  async function safelyStart(adapter: WayfinderAdapter): Promise<void> {
    try {
      await adapter.start(hostFor(adapter))
    } catch {
      // An adapter-wide exception supplies no trustworthy named source evidence.
      console.warn(`${adapter.type} adapter failed to start.`)
    }
    if (!stopped && !slices.has(adapter.type)) slices.set(adapter.type, { attempts: [] })
  }

  async function safelyStop(adapter: WayfinderAdapter): Promise<void> {
    try {
      await adapter.stop()
    } catch {
      console.warn(`${adapter.type} adapter failed to stop cleanly.`)
    }
  }

  return {
    snapshot: () => current,
    onChange(listener) {
      if (stopped) return () => undefined
      listeners.add(listener)
      if (current.capturedAt > 0) listener(current)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      if (startPromise) return startPromise
      startPromise = Promise.all(adapters.map((adapter) => safelyStart(adapter))).then(publish)
      return startPromise
    },
    async stop() {
      if (stopped) return
      stopped = true
      listeners.clear()
      await Promise.all(adapters.map((adapter) => safelyStop(adapter)))
    },
  }
}
