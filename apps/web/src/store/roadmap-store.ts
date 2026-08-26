import type {
  ApplicationState,
  Command,
  CommandOutcome,
  Query,
  QueryResult,
  SafeError,
} from '@roadmap/contracts'
import {
  commandResultEnvelopeCodec,
  queryResultEnvelopeCodec,
  stateEnvelopeCodec,
} from '@roadmap/contracts/codecs'

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/** Browser transport liveness, deliberately distinct from a domain Connection. */
export type TransportLiveness = 'connecting' | 'live' | 'disconnected'

export interface CommandActivity {
  inFlight: boolean
  error: SafeError | null
}

export interface RoadmapStoreSnapshot {
  transport: TransportLiveness
  /** Last authoritative replacement; retained while disconnected. */
  state: ApplicationState | null
  command: CommandActivity
}

export interface RoadmapStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): RoadmapStoreSnapshot
  query(query: Query): Promise<QueryResult>
  /** Rejects only when HTTP failure makes command completion unknowable. */
  execute(command: Command): Promise<CommandOutcome>
  /** Opens the socket. Ref-counted, so React StrictMode's double-subscribe is harmless. */
  start(): () => void
}

export interface SocketLike {
  addEventListener(
    type: 'open' | 'message' | 'close',
    listener: (event: { data?: unknown }) => void,
  ): void
  close(): void
}

export interface RoadmapStoreOptions {
  createSocket?: (url: string) => SocketLike
  fetch?: typeof fetch
  reconnectDelayMs?: (attempt: number) => number
}

const EMPTY_SNAPSHOT: RoadmapStoreSnapshot = {
  transport: 'connecting',
  state: null,
  command: { inFlight: false, error: null },
}

/**
 * The SPA's whole data Module. It orders full state from both wires, keeps stale state during
 * reconnects, and makes command ambiguity explicit instead of inventing an optimistic result.
 */
export function createRoadmapStore(
  serverUrl: string,
  options: RoadmapStoreOptions = {},
): RoadmapStore {
  const httpUrl = normalizedHttpUrl(serverUrl)
  const socketUrl = new URL('/ws', httpUrl)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const createSocket = options.createSocket ?? defaultCreateSocket
  const fetchRequest = options.fetch ?? fetch
  const reconnectDelayMs = options.reconnectDelayMs ?? defaultReconnectDelay

  let snapshot: RoadmapStoreSnapshot = EMPTY_SNAPSHOT
  const listeners = new Set<() => void>()
  const retiredEpochs = new Set<string>()
  let activeCommands = 0
  let socket: SocketLike | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let watchers = 0

  function publish(patch: Partial<RoadmapStoreSnapshot>): void {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

  function applyState(next: ApplicationState): boolean {
    const current = snapshot.state
    if (current !== null) {
      if (current.serverEpoch === next.serverEpoch) {
        if (next.stateSequence <= current.stateSequence) return false
      } else {
        if (retiredEpochs.has(next.serverEpoch)) return false
        retiredEpochs.add(current.serverEpoch)
      }
    }
    snapshot = { ...snapshot, state: next }
    return true
  }

  function connect(): void {
    const current = createSocket(socketUrl.href)
    socket = current

    current.addEventListener('open', () => {
      if (socket !== current) return
      attempts = 0
      publish({ transport: 'live' })
    })

    current.addEventListener('message', (event) => {
      if (socket !== current) return
      const message = parseJson(event.data)
      if (message === null) return
      const decoded = stateEnvelopeCodec.decode(message)
      if (!decoded.ok) return
      const changed = applyState(decoded.value.state)
      if (changed || snapshot.transport !== 'live') publish({ transport: 'live' })
    })

    current.addEventListener('close', () => {
      if (socket !== current) return
      socket = null
      publish({ transport: 'disconnected' })
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (watchers > 0) connect()
      }, reconnectDelayMs(attempts++))
    })
  }

  async function query(queryValue: Query): Promise<QueryResult> {
    try {
      const response = await fetchRequest(new URL('/api/query', httpUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'query', query: queryValue }),
      })
      const decoded = queryResultEnvelopeCodec.decode(await response.json())
      if (!decoded.ok) return transportQueryFailure('Server returned a malformed query result.')
      return decoded.value.result
    } catch {
      return transportQueryFailure('The query did not receive a valid server response.')
    }
  }

  async function execute(command: Command): Promise<CommandOutcome> {
    activeCommands += 1
    publish({ command: { inFlight: true, error: null } })
    try {
      const response = await fetchRequest(new URL('/api/command', httpUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'command', command }),
      })
      const decoded = commandResultEnvelopeCodec.decode(await response.json())
      if (!decoded.ok) throw new Error('Server returned a malformed command result.')
      applyState(decoded.value.outcome.state)
      publish({
        command: {
          inFlight: activeCommands > 1,
          error: decoded.value.outcome.ok ? null : decoded.value.outcome.error,
        },
      })
      return decoded.value.outcome
    } catch (error) {
      const failure: SafeError = {
        code: 'transport-failed',
        message:
          error instanceof Error
            ? `${error.message} The command may have completed; wait for live state before retrying.`
            : 'The command may have completed; wait for live state before retrying.',
      }
      publish({ command: { inFlight: activeCommands > 1, error: failure } })
      throw error
    } finally {
      activeCommands -= 1
      if (activeCommands === 0 && snapshot.command.inFlight) {
        publish({ command: { ...snapshot.command, inFlight: false } })
      }
    }
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
        socket = null
        closing.close()
      }
      publish({ transport: 'connecting' })
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    query,
    execute,
    start,
  }
}

function normalizedHttpUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Roadmap server URL must use http or https.')
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url
}

function defaultCreateSocket(url: string): SocketLike {
  return new WebSocket(url)
}

function defaultReconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
}

function parseJson(data: unknown): unknown | null {
  if (typeof data !== 'string') return null
  try {
    return JSON.parse(data) as unknown
  } catch {
    return null
  }
}

function transportQueryFailure(message: string): QueryResult {
  return { ok: false, error: { code: 'transport-failed', message } }
}
