import type {
  Command,
  CommandOutcome,
  Query,
  QueryResult,
  SafeError,
} from '@roadmap/contracts/operations'
import type { ApplicationState } from '@roadmap/contracts/state'
import {
  decodeCommandResultEnvelope,
  decodeQueryResultEnvelope,
  decodeRequestRejection,
  decodeStateEnvelope,
  REQUEST_ID_HEADER,
  type RequestRejection,
  requestRejectionStatus,
} from '@roadmap/contracts/wire'

interface RequestNotAdmitted {
  kind: 'not-admitted'
  ok: false
  rejection: RequestRejection
  error: SafeError
}

type CommandDelivery = CommandOutcome | RequestNotAdmitted
type QueryDelivery = QueryResult | RequestNotAdmitted
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/** Browser transport liveness, deliberately distinct from a domain Connection. */
export type TransportLiveness = 'connecting' | 'live' | 'disconnected'

export interface CommandActivity {
  inFlight: boolean
  error: SafeError | null
}

export type RoadmapStoreSnapshot = {
  transport: TransportLiveness
  command: CommandActivity
} & (
  | { synchronization: 'not-ready'; state: null }
  | { synchronization: 'synchronized' | 'retained'; state: ApplicationState }
)

interface EstablishedAuthority {
  readonly baseline: ApplicationState
}

interface SocketGeneration {
  readonly socket: SocketLike
  authority: EstablishedAuthority | null
}

export interface RoadmapStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): RoadmapStoreSnapshot
  query(query: Query): Promise<QueryDelivery>
  /** Rejects only when HTTP failure makes command completion unknowable. */
  execute(command: Command): Promise<CommandDelivery>
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
  synchronization: 'not-ready',
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
  let activeCommands = 0
  let generation: SocketGeneration | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let watchers = 0

  function publish(next: RoadmapStoreSnapshot): void {
    snapshot = next
    for (const listener of listeners) listener()
  }

  function retainState(transport: TransportLiveness): void {
    if (snapshot.state === null) {
      publish({ transport, synchronization: 'not-ready', state: null, command: snapshot.command })
    } else {
      publish({
        transport,
        synchronization: 'retained',
        state: snapshot.state,
        command: snapshot.command,
      })
    }
  }

  function publishState(state: ApplicationState): void {
    publish({
      transport: 'live',
      synchronization: 'synchronized',
      state,
      command: snapshot.command,
    })
  }

  function publishCommand(error: SafeError | null): void {
    publish({ ...snapshot, command: { inFlight: activeCommands > 0, error } })
  }

  function clearReconnect(): void {
    if (reconnectTimer === null) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function closeRetired(retired: SocketGeneration | null): void {
    if (retired === null) return
    try {
      retired.socket.close()
    } catch {
      // Its callbacks and request authority have already been invalidated.
    }
  }

  function scheduleReconnect(): void {
    if (watchers === 0 || generation !== null || reconnectTimer !== null) return
    const timer = setTimeout(() => {
      if (reconnectTimer !== timer) return
      reconnectTimer = null
      if (watchers > 0) connect()
    }, reconnectDelayMs(attempts++))
    reconnectTimer = timer
  }

  function acceptSocketState(current: SocketGeneration, next: ApplicationState): void {
    if (generation !== current || watchers === 0) return
    if (current.authority === null) {
      current.authority = { baseline: next }
      const previous = snapshot.state
      const state =
        previous !== null &&
        previous.serverEpoch === next.serverEpoch &&
        previous.stateSequence >= next.stateSequence
          ? previous
          : next
      publishState(state)
      return
    }
    if (
      next.serverEpoch !== current.authority.baseline.serverEpoch ||
      snapshot.synchronization !== 'synchronized' ||
      next.stateSequence <= snapshot.state.stateSequence
    )
      return
    publishState(next)
  }

  function connect(): void {
    if (watchers === 0 || generation !== null || reconnectTimer !== null) return
    let socket: SocketLike
    try {
      socket = createSocket(socketUrl.href)
    } catch {
      retainState('disconnected')
      scheduleReconnect()
      return
    }
    const current: SocketGeneration = { socket, authority: null }
    generation = current
    retainState('connecting')

    socket.addEventListener('open', () => {
      if (generation !== current || watchers === 0) return
      attempts = 0
      publish({ ...snapshot, transport: 'live' })
    })

    socket.addEventListener('message', (event) => {
      if (generation !== current || watchers === 0) return
      const message = parseJson(event.data)
      if (message === null) return
      const decoded = decodeStateEnvelope(message)
      if (!decoded.ok) return
      acceptSocketState(current, decoded.value.state)
    })

    socket.addEventListener('close', () => {
      if (generation !== current || watchers === 0) return
      generation = null
      retainState('disconnected')
      scheduleReconnect()
    })
  }

  function applyCommandState(authority: EstablishedAuthority | null, next: ApplicationState): void {
    if (
      authority === null ||
      watchers === 0 ||
      generation?.authority !== authority ||
      snapshot.synchronization !== 'synchronized'
    )
      return
    if (next.serverEpoch !== authority.baseline.serverEpoch) {
      const retired = generation
      generation = null
      clearReconnect()
      retainState('connecting')
      closeRetired(retired)
      connect()
      return
    }
    if (next.stateSequence > snapshot.state.stateSequence) publishState(next)
  }

  async function query(queryValue: Query): Promise<QueryDelivery> {
    try {
      const requestId = crypto.randomUUID()
      const response = await fetchRequest(new URL('/api/query', httpUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [REQUEST_ID_HEADER]: requestId },
        redirect: 'error',
        body: JSON.stringify({ type: 'query', query: queryValue }),
      })
      const body: unknown = await response.json()
      const rejection = attributableRejection(body, response.status, 'query', requestId)
      if (rejection !== null) return rejection
      if (response.status !== 200) {
        return transportQueryFailure('The query did not receive a valid server response.')
      }
      const decoded = decodeQueryResultEnvelope(body)
      if (!decoded.ok) {
        return transportQueryFailure('Server returned an invalid query result.')
      }
      return decoded.value.result
    } catch {
      return transportQueryFailure('The query did not receive a valid server response.')
    }
  }

  async function execute(command: Command): Promise<CommandDelivery> {
    const authority = generation?.authority ?? null
    activeCommands += 1
    let completionError: SafeError | null = null
    try {
      publishCommand(null)
      const requestId = crypto.randomUUID()
      const response = await fetchRequest(new URL('/api/command', httpUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [REQUEST_ID_HEADER]: requestId },
        redirect: 'error',
        body: JSON.stringify({ type: 'command', command }),
      })
      const body: unknown = await response.json()
      const rejection = attributableRejection(body, response.status, 'command', requestId)
      if (rejection !== null) {
        completionError = rejection.error
        return rejection
      }
      if (response.status !== 200) {
        throw new Error('The command did not receive a valid server response.')
      }
      const decoded = decodeCommandResultEnvelope(body, command)
      if (!decoded.ok) {
        throw new Error('Server returned an invalid command result.')
      }
      completionError = decoded.value.outcome.ok ? null : decoded.value.outcome.error
      applyCommandState(authority, decoded.value.outcome.state)
      return decoded.value.outcome
    } catch {
      completionError = {
        code: 'transport-failed',
        message: 'The command may have completed, but its completion is unknown.',
      }
      throw new Error(completionError.message)
    } finally {
      activeCommands -= 1
      publishCommand(completionError)
    }
  }

  function start(): () => void {
    watchers += 1
    if (watchers === 1) connect()
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      watchers -= 1
      if (watchers > 0) return
      clearReconnect()
      const retired = generation
      generation = null
      retainState('connecting')
      closeRetired(retired)
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
    return JSON.parse(data)
  } catch {
    return null
  }
}

function transportQueryFailure(message: string): QueryResult {
  return { ok: false, error: { code: 'transport-failed', message } }
}

function attributableRejection(
  body: unknown,
  status: number,
  request: RequestRejection['request'],
  requestId: string,
): RequestNotAdmitted | null {
  const decoded = decodeRequestRejection(body)
  if (
    !decoded.ok ||
    decoded.value.requestId !== requestId ||
    decoded.value.request !== request ||
    requestRejectionStatus(decoded.value.reason) !== status
  )
    return null
  return {
    kind: 'not-admitted',
    ok: false,
    rejection: decoded.value,
    error: { code: 'admission-failed', message: decoded.value.message },
  }
}
