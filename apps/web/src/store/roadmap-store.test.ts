import type { ApplicationState, CommandOutcome, Project, QueryResult } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { createRoadmapStore, type SocketLike } from './roadmap-store.ts'

type SocketEvent = 'open' | 'message' | 'close'

class FakeSocket implements SocketLike {
  closed = false
  private listeners: Record<SocketEvent, ((event: { data?: unknown }) => void)[]> = {
    open: [],
    message: [],
    close: [],
  }

  addEventListener(type: SocketEvent, listener: (event: { data?: unknown }) => void): void {
    this.listeners[type].push(listener)
  }

  close(): void {
    this.closed = true
  }

  emit(type: SocketEvent, data?: unknown): void {
    for (const listener of this.listeners[type]) listener({ data })
  }
}

function project(name: string): Project {
  return {
    key: { integration: 'github', id: name },
    name,
    visibility: 'public',
    openMaps: [],
    closedMaps: [],
    warnings: [],
  }
}

function state(
  stateSequence: number,
  serverEpoch = 'epoch-a',
  projects: Project[] = [],
): ApplicationState {
  return {
    serverEpoch,
    stateSequence,
    configurationVersion: 1,
    supportedIntegrations: [],
    connections: [],
    registrations: [],
    projects: [],
    authorizationOperations: [],
    configuration: { valid: true, issues: [], notices: [] },
    automation: { enabled: false, enabledProjects: [], availability: { status: 'ready' } },
    roadmap: { capturedAt: stateSequence * 1000, projects, unreachable: [] },
  }
}

function wire(value: ApplicationState): string {
  return JSON.stringify({ type: 'state', state: value })
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function harness(fetchRequest: typeof fetch = fetch) {
  const sockets: FakeSocket[] = []
  const socketUrls: string[] = []
  const delays: number[] = []
  const store = createRoadmapStore('http://test:8790', {
    createSocket: (url) => {
      socketUrls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    fetch: fetchRequest,
    reconnectDelayMs: (attempt) => {
      delays.push(attempt)
      return 0
    },
  })
  return { store, sockets, socketUrls, delays }
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createRoadmapStore', () => {
  it('starts with transport liveness separated from domain state', () => {
    const { store, sockets } = harness()
    expect(store.getSnapshot()).toEqual({
      transport: 'connecting',
      state: null,
      command: { inFlight: false, error: null },
    })
    expect(sockets).toHaveLength(0)
  })

  it('opens one derived state socket and accepts full authoritative replacements', () => {
    const { store, sockets, socketUrls } = harness()
    store.start()
    store.start()
    expect(socketUrls).toEqual(['ws://test:8790/ws'])

    sockets[0]?.emit('open')
    sockets[0]?.emit('message', wire(state(1, 'epoch-a', [project('a/one')])))
    sockets[0]?.emit('message', wire(state(2, 'epoch-a', [project('b/two')])))

    expect(store.getSnapshot().transport).toBe('live')
    expect(store.getSnapshot().state?.roadmap.projects.map((value) => value.name)).toEqual([
      'b/two',
    ])
  })

  it('ignores equal and older states, accepts a new epoch, then retires the old epoch', () => {
    const { store, sockets } = harness()
    store.start()
    const socket = sockets[0]
    socket?.emit('message', wire(state(4, 'epoch-a', [project('newest-a')])))
    socket?.emit('message', wire(state(4, 'epoch-a', [project('equal-a')])))
    socket?.emit('message', wire(state(3, 'epoch-a', [project('older-a')])))
    expect(store.getSnapshot().state?.roadmap.projects[0]?.name).toBe('newest-a')

    socket?.emit('message', wire(state(0, 'epoch-b', [project('restart-b')])))
    socket?.emit('message', wire(state(9, 'epoch-a', [project('late-a')])))
    expect(store.getSnapshot().state?.roadmap.projects[0]?.name).toBe('restart-b')
  })

  it('rejects malformed state deeply and retains the last valid state', () => {
    const { store, sockets } = harness()
    store.start()
    sockets[0]?.emit('message', wire(state(1)))
    sockets[0]?.emit('message', 'not json')
    sockets[0]?.emit(
      'message',
      JSON.stringify({ type: 'state', state: { ...state(2), token: 'x' } }),
    )
    sockets[0]?.emit(
      'message',
      JSON.stringify({ type: 'state', state: { ...state(2), roadmap: { projects: [] } } }),
    )
    expect(store.getSnapshot().state?.stateSequence).toBe(1)
  })

  it('keeps stale state through disconnect and reconnect with reset backoff', async () => {
    const { store, sockets, delays } = harness()
    store.start()
    sockets[0]?.emit('open')
    sockets[0]?.emit('message', wire(state(1, 'epoch-a', [project('kept')])))
    sockets[0]?.emit('close')

    expect(store.getSnapshot().transport).toBe('disconnected')
    expect(store.getSnapshot().state?.roadmap.projects[0]?.name).toBe('kept')
    await flushTimers()
    sockets[1]?.emit('close')
    await flushTimers()
    expect(delays).toEqual([0, 1])

    sockets[2]?.emit('open')
    sockets[2]?.emit('close')
    await flushTimers()
    expect(delays).toEqual([0, 1, 0])
  })

  it('stops reconnecting only after the last watcher leaves', async () => {
    const { store, sockets } = harness()
    const stopFirst = store.start()
    const stopLast = store.start()
    stopFirst()
    expect(sockets[0]?.closed).toBe(false)
    stopLast()
    expect(sockets[0]?.closed).toBe(true)
    sockets[0]?.emit('close')
    await flushTimers()
    expect(sockets).toHaveLength(1)
    expect(store.getSnapshot().transport).toBe('connecting')
  })

  it('applies a command response before resolving execute and records application errors', async () => {
    const response = deferred<Response>()
    const fetchRequest = () => response.promise
    const { store } = harness(fetchRequest as typeof fetch)
    const execution = store.execute({
      type: 'rename-connection',
      expectedConfigurationVersion: 1,
      connectionId: 'github-1',
      name: 'Renamed',
    })
    expect(store.getSnapshot().command.inFlight).toBe(true)

    const outcome: CommandOutcome = {
      ok: false,
      error: { code: 'conflict', message: 'Configuration changed.' },
      state: state(2),
    }
    response.resolve(jsonResponse({ type: 'command-result', outcome }, 409))
    await expect(execution).resolves.toEqual(outcome)
    expect(store.getSnapshot().state?.stateSequence).toBe(2)
    expect(store.getSnapshot().command).toEqual({ inFlight: false, error: outcome.error })
  })

  it('lets newer WebSocket state win a cross-wire race', async () => {
    const response = deferred<Response>()
    const { store, sockets } = harness((() => response.promise) as typeof fetch)
    store.start()
    sockets[0]?.emit('message', wire(state(1)))

    const execution = store.execute({
      type: 'refresh-project',
      expectedConfigurationVersion: 1,
      project: { integration: 'github', id: 'a/one' },
    })
    sockets[0]?.emit('message', wire(state(3, 'epoch-a', [project('newer')])))
    const outcome: CommandOutcome = {
      ok: true,
      result: { type: 'project-refreshed', project: { integration: 'github', id: 'a/one' } },
      state: state(2, 'epoch-a', [project('older-response')]),
    }
    response.resolve(jsonResponse({ type: 'command-result', outcome }))
    await execution

    expect(store.getSnapshot().state?.stateSequence).toBe(3)
    expect(store.getSnapshot().state?.roadmap.projects[0]?.name).toBe('newer')
  })

  it('surfaces HTTP failure ambiguity without replacing authoritative state', async () => {
    const { store, sockets } = harness((async () => {
      throw new Error('connection reset')
    }) as typeof fetch)
    store.start()
    sockets[0]?.emit('message', wire(state(1)))

    await expect(
      store.execute({
        type: 'refresh-project',
        expectedConfigurationVersion: 1,
        project: { integration: 'github', id: 'a/one' },
      }),
    ).rejects.toThrow('connection reset')
    expect(store.getSnapshot().state?.stateSequence).toBe(1)
    expect(store.getSnapshot().command.error).toMatchObject({ code: 'transport-failed' })
  })

  it('decodes query results and reports malformed results as transport failures', async () => {
    const success: QueryResult = {
      ok: true,
      type: 'workspace-selection',
      path: '/selected/workspace',
    }
    const replies = [
      jsonResponse({ type: 'query-result', result: success }),
      jsonResponse({ type: 'query-result', result: { ...success, token: 'secret' } }),
    ]
    const { store } = harness((async () => replies.shift() ?? new Response()) as typeof fetch)

    await expect(store.query({ type: 'select-workspace' })).resolves.toEqual(success)
    await expect(store.query({ type: 'select-workspace' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'transport-failed' },
    })
  })
})
