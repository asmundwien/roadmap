import type { MapRef, RateLimit, Snapshot } from '@roadmap/contracts'
import type { GitHubClient } from './github/client.ts'
import { discoverMaps } from './github/discovery.ts'
import { type FetchedMap, fetchMaps } from './github/map-query.ts'
import type { Invalidation } from './invalidation.ts'
import { toProjects } from './wayfinder/from-github.ts'

/** How long the store waits for a burst of invalidations to settle before refetching. One ticket
 * close fans out into several deliveries (`issues.closed`, `sub_issues`…); coalescing them keeps
 * the cost at one refetch while staying far inside the ~1s latency the destination asks for. */
const DEBOUNCE_MS = 250

export interface SnapshotStore {
  /** The current snapshot. Empty (zero `capturedAt`) until the baseline lands. */
  snapshot(): Snapshot
  /** Every map the store believes exists — the classifier's known-map universe. */
  knownMaps(): MapRef[]
  /** Registers for every state change. The listener also fires once if a snapshot exists. */
  onChange(listener: (snapshot: Snapshot) => void): () => void
  /** Full sweep: discovery, then every map. The baseline on start, and the reconciler's move. */
  reconcile(reason: string): Promise<void>
  /** Enqueues an invalidation; the debounced flush merges and executes it. Fire-and-forget. */
  invalidate(invalidation: Invalidation): void
  /** Cancels timers and pending flushes. */
  stop(): void
}

export interface SnapshotStoreOptions {
  debounceMs?: number
}

export function createSnapshotStore(
  client: GitHubClient,
  user: string,
  options: SnapshotStoreOptions = {},
): SnapshotStore {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS

  // The one state both funnels feed: the raw payload per map, plus the refs discovery believes
  // in. Projects are derived on publish, never stored.
  const fetchedByKey = new Map<string, FetchedMap>()
  const unreachableByKey = new Map<string, MapRef>()
  let refs: MapRef[] = []
  let rateLimit: RateLimit | null = null

  let current: Snapshot = { capturedAt: 0, projects: [], unreachable: [], rateLimit: null }
  // Change detection is a serialized fingerprint of what the views can see — `rateLimit` stays
  // out of it, or every reconcile would broadcast an otherwise-identical snapshot.
  let fingerprint = ''
  const listeners = new Set<(snapshot: Snapshot) => void>()

  // All fetching runs through one chain so a reconcile and a targeted refetch can never
  // interleave their writes. Ops swallow their own errors: the last good snapshot stays up.
  let chain: Promise<void> = Promise.resolve()
  let stopped = false

  const pending = { discovery: false, repos: new Set<string>(), maps: new Map<string, MapRef>() }
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function publish(): void {
    const projects = toProjects([...fetchedByKey.values()])
    const unreachable = [...unreachableByKey.values()].sort(
      (a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner) || a.number - b.number,
    )
    const next = JSON.stringify({ projects, unreachable })
    if (next === fingerprint) return
    fingerprint = next
    current = { capturedAt: Date.now(), projects, unreachable, rateLimit }
    for (const listener of listeners) listener(current)
  }

  function applyFetched(requested: MapRef[], maps: FetchedMap[], missing: MapRef[]): void {
    for (const entry of maps) {
      const key = keyOf(entry.ref)
      fetchedByKey.set(key, entry)
      unreachableByKey.delete(key)
    }
    // Missing means the API answered and had nothing — the map is gone from where we knew it.
    for (const ref of missing) {
      const key = keyOf(ref)
      fetchedByKey.delete(key)
      unreachableByKey.set(key, ref)
    }
    // A batch that failed outright returns neither; those refs keep their previous state.
    void requested
  }

  function enqueue(label: string, op: () => Promise<void>): Promise<void> {
    const run = chain.then(async () => {
      if (stopped) return
      try {
        await op()
      } catch (error) {
        console.warn(`${label} failed; keeping the last good snapshot`, error)
      }
    })
    chain = run
    return run
  }

  /** Forgets every map outside the discovered universe — gone is gone, not unreachable. */
  function retainOnly(known: Set<string>): void {
    for (const key of [...fetchedByKey.keys()]) {
      if (!known.has(key)) fetchedByKey.delete(key)
    }
    for (const key of [...unreachableByKey.keys()]) {
      if (!known.has(key)) unreachableByKey.delete(key)
    }
  }

  function reconcile(reason: string): Promise<void> {
    return enqueue(`reconcile (${reason})`, async () => {
      refs = await discoverMaps(client, user)
      retainOnly(new Set(refs.map(keyOf)))
      const result = await fetchMaps(client, refs)
      if (result.rateLimit) rateLimit = result.rateLimit
      applyFetched(refs, result.maps, result.missing)
      publish()
    })
  }

  function refetch(targets: MapRef[]): Promise<void> {
    return enqueue(`refetch (${targets.map(keyOf).join(', ')})`, async () => {
      // A webhook can name a map discovery hasn't seen yet (a just-labelled issue) — register
      // it, so the classifier and the next reconcile both know it.
      for (const ref of targets) {
        if (!refs.some((existing) => keyOf(existing) === keyOf(ref))) refs = [...refs, ref]
      }
      const result = await fetchMaps(client, targets)
      if (result.rateLimit) rateLimit = result.rateLimit
      applyFetched(targets, result.maps, result.missing)
      publish()
    })
  }

  function flush(): void {
    debounceTimer = null
    if (pending.discovery) {
      pending.discovery = false
      pending.repos.clear()
      pending.maps.clear()
      void reconcile('webhook')
      return
    }
    const targets = new Map<string, MapRef>(pending.maps)
    for (const repo of pending.repos) {
      for (const ref of refs) {
        if (ref.nameWithOwner === repo) targets.set(keyOf(ref), ref)
      }
    }
    pending.repos.clear()
    pending.maps.clear()
    if (targets.size > 0) void refetch([...targets.values()])
  }

  function invalidate(invalidation: Invalidation): void {
    if (stopped || invalidation.kind === 'ignore') return
    switch (invalidation.kind) {
      case 'discovery':
        pending.discovery = true
        break
      case 'repos':
        for (const repo of invalidation.repos) pending.repos.add(repo)
        break
      case 'maps':
        for (const ref of invalidation.refs) pending.maps.set(keyOf(ref), ref)
        break
    }
    if (debounceTimer === null) debounceTimer = setTimeout(flush, debounceMs)
  }

  return {
    snapshot: () => current,
    knownMaps: () => [...refs],
    onChange(listener) {
      listeners.add(listener)
      if (current.capturedAt > 0) listener(current)
      return () => {
        listeners.delete(listener)
      }
    },
    reconcile,
    invalidate,
    stop() {
      stopped = true
      if (debounceTimer !== null) clearTimeout(debounceTimer)
    },
  }
}

function keyOf(ref: MapRef): string {
  return `${ref.nameWithOwner}#${ref.number}`
}
