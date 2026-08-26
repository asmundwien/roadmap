import type { Integration, Project, Snapshot, Unreachable } from '@roadmap/contracts'

export interface AdapterSlice {
  projects: Project[]
  unreachable: Unreachable[]
}

export interface AdapterHost {
  /** Replace this adapter's whole current slice. Call whenever anything this adapter owns changes. */
  update(slice: AdapterSlice): void
}

export interface WayfinderAdapter {
  type: Integration
  start(host: AdapterHost): void | Promise<void>
  stop(): void | Promise<void>
}

export interface SnapshotStore {
  /** The current snapshot. Empty (zero `capturedAt`) until every adapter baseline lands. */
  snapshot(): Snapshot
  /** Registers for every complete state change. The listener also fires once if a snapshot exists. */
  onChange(listener: (snapshot: Snapshot) => void): () => void
  /** Starts every adapter and resolves only after the first complete composed baseline. */
  start(): Promise<void>
  /** Stops every adapter and prevents later slice publishes. */
  stop(): Promise<void>
}

export function createSnapshotStore(adapters: readonly WayfinderAdapter[]): SnapshotStore {
  if (new Set(adapters.map((adapter) => adapter.type)).size !== adapters.length) {
    throw new Error('createSnapshotStore requires one adapter per Integration')
  }
  const slices = new Map<Integration, AdapterSlice>()
  let current: Snapshot = { capturedAt: 0, projects: [], unreachable: [] }
  let fingerprint = ''
  const listeners = new Set<(snapshot: Snapshot) => void>()
  let stopped = false
  let startPromise: Promise<void> | null = null

  function publish(): void {
    if (slices.size !== adapters.length) return
    const projects = [...slices.values()].flatMap((slice) => slice.projects).sort(compareProjects)
    const unreachable = [...slices.values()]
      .flatMap((slice) => slice.unreachable)
      .sort(compareUnreachable)
    const next = JSON.stringify({ projects, unreachable })
    if (next === fingerprint) return
    fingerprint = next
    current = { capturedAt: Date.now(), projects, unreachable }
    for (const listener of listeners) listener(current)
  }

  function hostFor(adapter: WayfinderAdapter): AdapterHost {
    return {
      update(slice) {
        if (stopped) return
        slices.set(adapter.type, slice)
        publish()
      },
    }
  }

  async function safelyStart(adapter: WayfinderAdapter): Promise<void> {
    try {
      await adapter.start(hostFor(adapter))
      if (!slices.has(adapter.type)) slices.set(adapter.type, { projects: [], unreachable: [] })
    } catch (error) {
      console.warn(`${adapter.type} adapter failed to start; using an empty baseline`, error)
      slices.set(adapter.type, { projects: [], unreachable: [] })
    }
  }

  async function safelyStop(adapter: WayfinderAdapter): Promise<void> {
    try {
      await adapter.stop()
    } catch (error) {
      console.warn(`${adapter.type} adapter failed to stop cleanly`, error)
    }
  }

  return {
    snapshot: () => current,
    onChange(listener) {
      listeners.add(listener)
      if (current.capturedAt > 0) listener(current)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      if (startPromise) return startPromise
      startPromise = Promise.all(adapters.map((adapter) => safelyStart(adapter))).then(() => {
        publish()
      })
      return startPromise
    },
    async stop() {
      if (stopped) return
      stopped = true
      await Promise.all(adapters.map((adapter) => safelyStop(adapter)))
    },
  }
}

function compareProjects(a: Project, b: Project): number {
  return (
    Number(b.openMaps.length > 0) - Number(a.openMaps.length > 0) || a.name.localeCompare(b.name)
  )
}

function compareUnreachable(a: Unreachable, b: Unreachable): number {
  return (
    a.project.integration.localeCompare(b.project.integration) ||
    a.project.id.localeCompare(b.project.id) ||
    (a.mapId ?? '').localeCompare(b.mapId ?? '') ||
    a.reason.localeCompare(b.reason)
  )
}
