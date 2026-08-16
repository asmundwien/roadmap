import type { MapRef, Project, RateLimit, ServerMessage } from '@roadmap/contracts'

/** Reconnect backoff: quick first retry, doubling to a lazy ceiling — the server may be down. */
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/**
 * How the SPA stands relative to the server.
 *
 * - `connecting` — no socket yet; nothing has arrived.
 * - `live` — the socket is open; what is on screen is what the server last broadcast.
 * - `disconnected` — the socket dropped; the last snapshot is kept but stale, reconnect pending.
 */
export type ConnectionState = 'connecting' | 'live' | 'disconnected'

export interface RoadmapSnapshot {
  connection: ConnectionState
  projects: Project[]
  /** Discovered maps the map query returned nothing for — deleted, renamed, or now invisible. */
  unreachable: MapRef[]
  rateLimit: RateLimit | null
  /** When the server assembled what is on screen; null until the first snapshot arrives. */
  capturedAt: number | null
}

export interface RoadmapStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): RoadmapSnapshot
  /** Opens the socket. Ref-counted, so React StrictMode's double-subscribe is harmless. */
  start(): () => void
}

/** The sliver of `WebSocket` the store touches, so tests can hand in a fake. */
export interface SocketLike {
  addEventListener(
    type: 'open' | 'message' | 'close',
    listener: (event: { data?: unknown }) => void,
  ): void
  close(): void
}

export interface RoadmapStoreOptions {
  createSocket?: (url: string) => SocketLike
  /** Injected so tests need no real clock; defaults to exponential backoff. */
  reconnectDelayMs?: (attempt: number) => number
}

const EMPTY_SNAPSHOT: RoadmapSnapshot = {
  connection: 'connecting',
  projects: [],
  unreachable: [],
  rateLimit: null,
  capturedAt: null,
}

/**
 * The SPA's whole data layer: a subscription to the server's WebSocket. Every message replaces
 * the snapshot wholesale — the wire carries no patches — and a dropped socket keeps the last
 * snapshot on screen, marked `disconnected`, while reconnecting on its own.
 */
export function createRoadmapStore(url: string, options: RoadmapStoreOptions = {}): RoadmapStore {
  const createSocket = options.createSocket ?? defaultCreateSocket
  const reconnectDelayMs = options.reconnectDelayMs ?? defaultReconnectDelay

  let snapshot: RoadmapSnapshot = EMPTY_SNAPSHOT
  const listeners = new Set<() => void>()

  let socket: SocketLike | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let watchers = 0

  function publish(patch: Partial<RoadmapSnapshot>): void {
    // A fresh object every publish, and only on publish — `getSnapshot` must stay referentially
    // stable between changes or `useSyncExternalStore` loops.
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

  function connect(): void {
    const current = createSocket(url)
    socket = current

    current.addEventListener('open', () => {
      if (socket !== current) return
      attempts = 0
      publish({ connection: 'live' })
    })

    current.addEventListener('message', (event) => {
      if (socket !== current) return
      const message = parseMessage(event.data)
      if (message === null) return
      publish({
        connection: 'live',
        projects: message.snapshot.projects,
        unreachable: message.snapshot.unreachable,
        rateLimit: message.snapshot.rateLimit,
        capturedAt: message.snapshot.capturedAt,
      })
    })

    current.addEventListener('close', () => {
      if (socket !== current) return
      socket = null
      publish({ connection: 'disconnected' })
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (watchers > 0) connect()
      }, reconnectDelayMs(attempts++))
    })
  }

  function start(): () => void {
    watchers += 1
    if (watchers === 1 && socket === null && reconnectTimer === null) connect()
    return () => {
      watchers -= 1
      if (watchers > 0) return
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (socket !== null) {
        const closing = socket
        socket = null // Detach first, so the close handler neither publishes nor reconnects.
        closing.close()
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
  }
}

function defaultCreateSocket(url: string): SocketLike {
  return new WebSocket(url)
}

function defaultReconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
}

/** The server is trusted, the transport is not: anything unparsable is dropped, never thrown. */
function parseMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  if (!('type' in parsed) || parsed.type !== 'snapshot') return null
  if (!('snapshot' in parsed) || typeof parsed.snapshot !== 'object' || parsed.snapshot === null) {
    return null
  }
  return parsed as ServerMessage
}
