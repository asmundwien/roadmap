import {
  type CorrelationId,
  correlationIdSchema,
  type ServerEpoch,
} from '@roadmap/contracts/identity'
import type { Command, CommandOutcomeFor, Query } from '@roadmap/contracts/operations'
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

import {
  createRoadmapWorkflows,
  type RoadmapWorkflows,
  type WorkflowCompletionUnknown,
  type WorkflowLifecycle,
  type WorkflowQueryDelivery,
  type WorkflowRequestNotAdmitted,
  type WorkflowSnapshot,
} from '../workflows/workflows.ts'

type CommandDelivery<C extends Command> = CommandOutcomeFor<C> | WorkflowRequestNotAdmitted
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/** Browser transport liveness, deliberately distinct from a domain Connection. */
export type TransportLiveness = 'connecting' | 'live' | 'disconnected'

export type RoadmapLifecycle = WorkflowLifecycle

export type RoadmapStoreSnapshot = {
  readonly transport: TransportLiveness
  readonly lifecycle: RoadmapLifecycle | null
  readonly workflows: WorkflowSnapshot
} & (
  | { readonly synchronization: 'not-ready'; readonly state: null }
  | {
      readonly synchronization: 'synchronized' | 'retained'
      readonly state: Readonly<ApplicationState>
    }
)

interface EstablishedAuthority {
  readonly serverEpoch: ApplicationState['serverEpoch']
}

interface SocketGeneration {
  readonly socket: SocketLike
  authority: EstablishedAuthority | null
}

export interface RoadmapStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): RoadmapStoreSnapshot
  readonly workflows: RoadmapWorkflows
  query(query: Query): Promise<WorkflowQueryDelivery>
  /** Rejects only when HTTP failure makes command completion unknowable. */
  execute<C extends Command>(command: C): Promise<CommandDelivery<C>>
  /** Acquires one observation owner. Each release is idempotent. */
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

const EMPTY_SNAPSHOT: RoadmapStoreSnapshot = freezePublished<RoadmapStoreSnapshot>({
  transport: 'connecting',
  synchronization: 'not-ready',
  lifecycle: null,
  state: null,
  workflows: {
    attempts: [],
    policy: { synchronization: 'not-ready', lifecycle: null, state: null },
  },
})

/** Owns accepted socket facts, read retention, transport, and browser workflow integration. */
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
  let generation: SocketGeneration | null = null
  let acceptedPublication: Readonly<
    Pick<ApplicationState, 'serverEpoch' | 'stateSequence'>
  > | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let owners = 0

  const workflowOwner = createRoadmapWorkflows({
    read: () => ({
      synchronization: snapshot.synchronization,
      lifecycle: snapshot.lifecycle,
      state: snapshot.state,
    }),
    dispatch: (command, onDispatch) => dispatchCommand(command, onDispatch),
    query: (onDispatch) => dispatchQuery({ type: 'select-workspace' }, onDispatch),
    publish(workflows) {
      snapshot = freezePublished({ ...snapshot, workflows })
      for (const listener of listeners) listener()
    },
  })

  function publish(next: RoadmapStoreSnapshot): void {
    workflowOwner.synchronize({
      synchronization: next.synchronization,
      lifecycle: next.lifecycle,
      state: next.state,
    })
    snapshot = freezePublished({ ...next, workflows: workflowOwner.getSnapshot() })
    for (const listener of listeners) listener()
  }

  function retainState(transport: TransportLiveness): void {
    if (snapshot.state === null) {
      publish({ ...snapshot, transport, synchronization: 'not-ready', state: null })
    } else {
      publish({ ...snapshot, transport, synchronization: 'retained', state: snapshot.state })
    }
  }

  function publishState(state: ApplicationState): void {
    const lifecycle = lifecycleOf(state)
    const readable = state.phase === 'ready' || ('retained' in state && state.retained !== null)
    const content = readable ? state : snapshot.state
    if (content === null) {
      publish({
        ...snapshot,
        transport: 'live',
        synchronization: 'not-ready',
        lifecycle,
        state: null,
      })
    } else {
      publish({
        ...snapshot,
        transport: 'live',
        synchronization: lifecycle.phase === 'ready' ? 'synchronized' : 'retained',
        lifecycle,
        state: content,
      })
    }
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
    if (owners === 0 || generation !== null || reconnectTimer !== null) return
    const timer = setTimeout(() => {
      if (reconnectTimer !== timer) return
      reconnectTimer = null
      if (owners > 0) connect()
    }, reconnectDelayMs(attempts++))
    reconnectTimer = timer
  }

  function acceptSocketState(current: SocketGeneration, next: ApplicationState): void {
    if (generation !== current || owners === 0) return
    if (current.authority === null) {
      current.authority = { serverEpoch: next.serverEpoch }
      if (
        acceptedPublication !== null &&
        acceptedPublication.serverEpoch === next.serverEpoch &&
        acceptedPublication.stateSequence >= next.stateSequence
      ) {
        if (snapshot.state === null) {
          publish({ ...snapshot, transport: 'live', synchronization: 'not-ready', state: null })
        } else {
          publish({
            ...snapshot,
            transport: 'live',
            synchronization: snapshot.lifecycle?.phase === 'ready' ? 'synchronized' : 'retained',
            state: snapshot.state,
          })
        }
        return
      }
    } else if (
      next.serverEpoch !== current.authority.serverEpoch ||
      (acceptedPublication !== null && next.stateSequence <= acceptedPublication.stateSequence)
    ) {
      return
    }
    acceptedPublication = { serverEpoch: next.serverEpoch, stateSequence: next.stateSequence }
    publishState(next)
  }

  function connect(): void {
    if (owners === 0 || generation !== null || reconnectTimer !== null) return
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
      if (generation !== current || owners === 0) return
      attempts = 0
      publish({ ...snapshot, transport: 'live' })
    })

    socket.addEventListener('message', (event) => {
      if (generation !== current || owners === 0) return
      const message = parseJson(event.data)
      if (message === null) return
      const decoded = decodeStateEnvelope(message)
      if (!decoded.ok) return
      acceptSocketState(current, decoded.value.state)
    })

    socket.addEventListener('close', () => {
      if (generation !== current || owners === 0) return
      generation = null
      retainState('disconnected')
      scheduleReconnect()
    })
  }

  function observeOutcomeEpoch(
    authority: EstablishedAuthority | null,
    serverEpoch: ServerEpoch,
  ): void {
    if (
      authority === null ||
      owners === 0 ||
      generation?.authority !== authority ||
      serverEpoch === authority.serverEpoch
    )
      return
    const retired = generation
    generation = null
    clearReconnect()
    closeRetired(retired)
    retainState('connecting')
    connect()
  }

  async function dispatchQuery(
    queryValue: Query,
    onDispatch?: () => void,
  ): Promise<WorkflowQueryDelivery> {
    const authority = generation?.authority ?? null
    const correlationId = correlationIdSchema.parse(crypto.randomUUID())
    try {
      const request = fetchRequest(new URL('/api/query', httpUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [REQUEST_ID_HEADER]: correlationId },
        redirect: 'error',
        body: JSON.stringify({ type: 'query', correlationId, query: queryValue }),
      })
      onDispatch?.()
      const response = await request
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return transportFailure(
          'delivery',
          'The query completion is unknown because its response was unreadable.',
        )
      }
      const rejection = attributableRejection(body, response.status, 'query', correlationId)
      if (rejection !== null) return rejection
      if (response.status !== 200) {
        return transportFailure('protocol', 'The query did not receive a valid server response.')
      }
      const decoded = decodeQueryResultEnvelope(body, queryValue, correlationId)
      if (!decoded.ok) {
        return transportFailure('protocol', 'Server returned an invalid query result.')
      }
      observeOutcomeEpoch(authority, decoded.value.result.serverEpoch)
      return decoded.value.result
    } catch {
      return transportFailure('delivery', 'The query completion is unknown.')
    }
  }

  async function dispatchCommand<C extends Command>(
    command: C,
    onDispatch?: () => void,
  ): Promise<CommandDelivery<C> | WorkflowCompletionUnknown> {
    const authority = generation?.authority ?? null
    const correlationId = correlationIdSchema.parse(crypto.randomUUID())
    try {
      const request = fetchRequest(new URL('/api/command', httpUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [REQUEST_ID_HEADER]: correlationId },
        redirect: 'error',
        body: JSON.stringify({ type: 'command', correlationId, command }),
      })
      onDispatch?.()
      const response = await request
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return transportFailure(
          'delivery',
          'The command may have completed, but its response was unreadable and its completion is unknown.',
        )
      }
      const rejection = attributableRejection(body, response.status, 'command', correlationId)
      if (rejection !== null) return rejection
      if (response.status !== 200) {
        return transportFailure(
          'protocol',
          'The command may have completed, but it did not receive a valid server response. Its completion is unknown.',
        )
      }
      const decoded = decodeCommandResultEnvelope(body, command, correlationId)
      if (!decoded.ok) {
        return transportFailure(
          'protocol',
          'The command may have completed, but its result was invalid and its completion is unknown.',
        )
      }
      observeOutcomeEpoch(authority, decoded.value.outcome.serverEpoch)
      return decoded.value.outcome
    } catch {
      return transportFailure(
        'delivery',
        'The command may have completed, but its completion is unknown.',
      )
    }
  }

  async function execute<C extends Command>(command: C): Promise<CommandDelivery<C>> {
    const delivery = await dispatchCommand(command)
    if ('kind' in delivery && delivery.kind === 'completion-unknown')
      throw new Error(delivery.error.message)
    return delivery
  }

  function start(): () => void {
    owners += 1
    if (owners === 1) connect()
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      owners -= 1
      if (owners > 0) return
      clearReconnect()
      const retired = generation
      generation = null
      closeRetired(retired)
      retainState('disconnected')
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    workflows: workflowOwner.workflows,
    query: dispatchQuery,
    execute,
    start,
  }
}

function lifecycleOf(state: ApplicationState): RoadmapLifecycle {
  switch (state.phase) {
    case 'ready':
      return { phase: state.phase, mode: state.mode }
    case 'failed':
      return { phase: state.phase, cause: state.cause }
    case 'idle':
    case 'starting':
    case 'stopping':
    case 'stopped':
      return { phase: state.phase }
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

function freezePublished<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key in value) {
    if (Object.hasOwn(value, key)) freezePublished(value[key])
  }
  Object.freeze(value)
  return value
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

function transportFailure(
  reason: WorkflowCompletionUnknown['reason'],
  message: string,
): WorkflowCompletionUnknown {
  return {
    kind: 'completion-unknown',
    reason,
    ok: false,
    error: { code: 'transport-failed', message },
  }
}

function attributableRejection(
  body: unknown,
  status: number,
  request: RequestRejection['request'],
  requestId: CorrelationId,
): WorkflowRequestNotAdmitted | null {
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
