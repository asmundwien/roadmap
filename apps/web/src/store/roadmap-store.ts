import type { Project } from '@roadmap/contracts'
import type { GitHubClient, RateLimit } from '../github/client.ts'
import { discoverMaps, type MapRef } from '../github/discovery.ts'
import { fetchMaps } from '../github/map-query.ts'
import { toProjects } from '../wayfinder/from-github.ts'

/** The fast loop: map contents, where the frontier actually moves. */
const MAP_POLL_MS = 90_000
/** The slow loop: which maps exist. New maps are rare, and search polls can't be conditional. */
const DISCOVERY_POLL_MS = 5 * 60_000

/**
 * Budget valve. GraphQL polls can't be made conditional — GitHub sends no ETag on `POST /graphql`
 * (`docs/research/github-api-primitives.md` §4d) — so every poll pays its cost and the only lever
 * is how often we poll. At the measured 3 points per map this never trips below ~13 maps.
 */
const THROTTLE_STEPS: { remainingBelow: number; multiplier: number }[] = [
  { remainingBelow: 300, multiplier: 8 },
  { remainingBelow: 1000, multiplier: 4 },
  { remainingBelow: 2000, multiplier: 2 },
]

export type RoadmapStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RoadmapSnapshot {
  status: RoadmapStatus
  projects: Project[]
  /** Set on failure; the last good `projects` is kept alongside it rather than blanked. */
  error: string | null
  lastUpdatedAt: number | null
  rateLimit: RateLimit | null
  /** Discovered maps the map query returned nothing for — deleted, renamed, or now invisible. */
  unreachable: MapRef[]
}

export interface RoadmapStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): RoadmapSnapshot
  /** Begins polling. Ref-counted, so React StrictMode's double-subscribe is harmless. */
  start(): () => void
  /** Forces a poll now, outside the schedule. Concurrent calls share one in-flight refresh. */
  refresh(): Promise<void>
}

export interface RoadmapStoreOptions {
  mapPollMs?: number
  discoveryPollMs?: number
  /** Injected so tests need no DOM; defaults to pausing the loop while the tab is hidden. */
  isVisible?: () => boolean
}

const EMPTY_SNAPSHOT: RoadmapSnapshot = {
  status: 'idle',
  projects: [],
  error: null,
  lastUpdatedAt: null,
  rateLimit: null,
  unreachable: [],
}

export function createRoadmapStore(
  client: GitHubClient,
  user: string,
  options: RoadmapStoreOptions = {},
): RoadmapStore {
  const mapPollMs = options.mapPollMs ?? MAP_POLL_MS
  const discoveryPollMs = options.discoveryPollMs ?? DISCOVERY_POLL_MS
  const isVisible = options.isVisible ?? defaultIsVisible

  let snapshot: RoadmapSnapshot = EMPTY_SNAPSHOT
  const listeners = new Set<() => void>()

  let refs: MapRef[] = []
  let discoveredAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let subscribers = 0

  function publish(patch: Partial<RoadmapSnapshot>): void {
    // A fresh object every publish, and only on publish — `getSnapshot` must stay referentially
    // stable between changes or `useSyncExternalStore` loops.
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

  async function poll(): Promise<void> {
    if (snapshot.status === 'idle') publish({ status: 'loading' })

    try {
      const now = Date.now()
      if (refs.length === 0 || now - discoveredAt >= discoveryPollMs) {
        refs = await discoverMaps(client, user)
        discoveredAt = now
      }

      const result = await fetchMaps(client, refs)
      publish({
        status: 'ready',
        projects: toProjects(result.maps),
        error: null,
        lastUpdatedAt: Date.now(),
        rateLimit: result.rateLimit,
        unreachable: result.missing,
      })
    } catch (error) {
      publish({ status: 'error', error: describe(error) })
    }
  }

  function refresh(): Promise<void> {
    if (inFlight) return inFlight
    const run = poll().finally(() => {
      inFlight = null
    })
    inFlight = run
    return run
  }

  function nextDelay(): number {
    const remaining = snapshot.rateLimit?.remaining
    if (remaining === undefined) return mapPollMs
    const step = THROTTLE_STEPS.find((candidate) => remaining < candidate.remainingBelow)
    return mapPollMs * (step?.multiplier ?? 1)
  }

  function schedule(): void {
    if (subscribers === 0) return
    timer = setTimeout(() => {
      // A hidden tab burns rate limit nobody is reading; skip the poll but keep the loop alive.
      const tick = isVisible() ? refresh() : Promise.resolve()
      void tick.finally(schedule)
    }, nextDelay())
  }

  function start(): () => void {
    subscribers += 1
    if (subscribers === 1) {
      void refresh().finally(schedule)
    }
    return () => {
      subscribers -= 1
      if (subscribers === 0 && timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    start,
    refresh,
  }
}

function defaultIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
