import type { ApplicationState, CommandOutcome, Project, QueryResult } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { createRoadmapStore, type SocketLike } from './roadmap-store'

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
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
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

function requestRejection(
  request: 'query' | 'command',
  requestId: string | null,
  reason = 'origin',
) {
  return {
    type: 'request-rejected',
    request,
    requestId,
    reason,
    message: 'The request was rejected before admission.',
  }
}

const rejectionPolicies = [
  { reason: 'origin', status: 403 },
  { reason: 'peer', status: 403 },
  { reason: 'method', status: 405 },
  { reason: 'media-type', status: 415 },
  { reason: 'too-large', status: 413 },
  { reason: 'malformed-json', status: 400 },
  { reason: 'malformed-envelope', status: 400 },
  { reason: 'interrupted', status: 400 },
]

const uncertainReplies = [
  {
    name: 'a different request UUID',
    status: 403,
    body: (_requestId, request) =>
      requestRejection(request, '00000000-0000-4000-8000-000000000000'),
  },
  {
    name: 'the wrong endpoint family',
    status: 403,
    body: (requestId, request) =>
      requestRejection(request === 'command' ? 'query' : 'command', requestId),
  },
  {
    name: 'a rejection reason with the wrong HTTP status',
    status: 400,
    body: (requestId, request) => requestRejection(request, requestId),
  },
  {
    name: 'a rejection envelope with HTTP success status',
    status: 200,
    body: (requestId, request) => requestRejection(request, requestId),
  },
  {
    name: 'an undeclared rejection reason',
    status: 403,
    body: (requestId, request) => requestRejection(request, requestId, 'internal-error'),
  },
  {
    name: 'a null request UUID',
    status: 403,
    body: (_requestId, request) => requestRejection(request, null),
  },
  {
    name: 'an undeclared rejection field',
    status: 403,
    body: (requestId, request) => ({
      ...requestRejection(request, requestId),
      retryable: true,
    }),
  },
  {
    name: 'a secret rejection field',
    status: 403,
    body: (requestId, request) => ({
      ...requestRejection(request, requestId),
      token: 'private-token',
    }),
  },
  {
    name: 'fabricated state in a rejection',
    status: 403,
    body: (requestId, request) => ({
      ...requestRejection(request, requestId),
      state: state(99),
    }),
  },
  {
    name: 'a fabricated command outcome in a rejection',
    status: 403,
    body: (requestId, request) => ({
      ...requestRejection(request, requestId),
      outcome: {
        ok: false,
        error: { code: 'admission-failed', message: 'Not admitted.' },
        state: state(99),
      },
    }),
  },
  {
    name: 'a generic JSON 403',
    status: 403,
    body: () => ({ message: 'Forbidden' }),
  },
  {
    name: 'a generic JSON 500',
    status: 500,
    body: () => ({ message: 'Internal server error' }),
  },
] satisfies {
  name: string
  status: number
  body: (requestId: string | null, request: 'query' | 'command') => unknown
}[]

const unreadableReplies = [
  {
    name: 'a plain HTTP 403',
    respond: async () => new Response('Forbidden', { status: 403 }),
  },
  {
    name: 'a plain HTTP 500',
    respond: async () => new Response('Internal server error', { status: 500 }),
  },
  {
    name: 'a JSON read failure',
    respond: async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
  },
  {
    name: 'a fetch failure',
    respond: async () => {
      throw new Error('Network connection failed.')
    },
  },
]

const commandResultPairs: {
  name: string
  command: Parameters<ReturnType<typeof createRoadmapStore>['execute']>[0]
  result: Extract<CommandOutcome, { ok: true }>['result']
  mismatches: { name: string; result: Extract<CommandOutcome, { ok: true }>['result'] }[]
}[] = [
  {
    name: 'authorization start',
    command: { type: 'begin-github-authorization', expectedConfigurationVersion: 1, name: 'Work' },
    result: { type: 'authorization-started', operationId: 'authorization-1' },
    mismatches: [
      {
        name: 'operation family',
        result: { type: 'authorization-cancelled', operationId: 'authorization-1' },
      },
    ],
  },
  {
    name: 'authorization retry',
    command: {
      type: 'retry-github-authorization',
      expectedConfigurationVersion: 1,
      operationId: 'authorization-1',
    },
    result: { type: 'authorization-started', operationId: 'authorization-1' },
    mismatches: [
      {
        name: 'operation identifier',
        result: { type: 'authorization-started', operationId: 'authorization-2' },
      },
    ],
  },
  {
    name: 'configuration update',
    command: {
      type: 'rename-connection',
      expectedConfigurationVersion: 1,
      connectionId: 'connection-1',
      name: 'Work',
    },
    result: { type: 'configuration-updated', configurationVersion: 1 },
    mismatches: [
      {
        name: 'result/state configuration version',
        result: { type: 'configuration-updated', configurationVersion: 2 },
      },
      { name: 'operation family', result: { type: 'action-launched', actionId: 'action-1' } },
    ],
  },
  {
    name: 'project refresh',
    command: {
      type: 'refresh-project',
      expectedConfigurationVersion: 1,
      project: { integration: 'github', id: 'a/one' },
    },
    result: { type: 'project-refreshed', project: { integration: 'github', id: 'a/one' } },
    mismatches: [
      {
        name: 'operation family',
        result: { type: 'configuration-updated', configurationVersion: 2 },
      },
      {
        name: 'project identifier',
        result: { type: 'project-refreshed', project: { integration: 'github', id: 'b/two' } },
      },
      {
        name: 'project integration',
        result: { type: 'project-refreshed', project: { integration: 'local', id: 'a/one' } },
      },
    ],
  },
  {
    name: 'authorization cancellation',
    command: {
      type: 'cancel-github-authorization',
      expectedConfigurationVersion: 1,
      operationId: 'authorization-1',
    },
    result: { type: 'authorization-cancelled', operationId: 'authorization-1' },
    mismatches: [
      {
        name: 'operation identifier',
        result: { type: 'authorization-cancelled', operationId: 'authorization-2' },
      },
    ],
  },
  {
    name: 'action launch',
    command: { type: 'launch-action', expectedConfigurationVersion: 1, actionId: 'action-1' },
    result: { type: 'action-launched', actionId: 'action-1' },
    mismatches: [
      { name: 'action identifier', result: { type: 'action-launched', actionId: 'action-2' } },
    ],
  },
  {
    name: 'automation override',
    command: {
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target: {
        project: { integration: 'github', id: 'a/one' },
        mapId: 'map-1',
        ticketId: 'ticket-1',
      },
      stage: 'classification',
    },
    result: {
      type: 'automation-override-started',
      target: {
        project: { integration: 'github', id: 'a/one' },
        mapId: 'map-1',
        ticketId: 'ticket-1',
      },
      stage: 'classification',
    },
    mismatches: [
      {
        name: 'project identifier',
        result: {
          type: 'automation-override-started',
          target: {
            project: { integration: 'github', id: 'b/two' },
            mapId: 'map-1',
            ticketId: 'ticket-1',
          },
          stage: 'classification',
        },
      },
      {
        name: 'project integration',
        result: {
          type: 'automation-override-started',
          target: {
            project: { integration: 'local', id: 'a/one' },
            mapId: 'map-1',
            ticketId: 'ticket-1',
          },
          stage: 'classification',
        },
      },
      {
        name: 'map identifier',
        result: {
          type: 'automation-override-started',
          target: {
            project: { integration: 'github', id: 'a/one' },
            mapId: 'map-2',
            ticketId: 'ticket-1',
          },
          stage: 'classification',
        },
      },
      {
        name: 'ticket identifier',
        result: {
          type: 'automation-override-started',
          target: {
            project: { integration: 'github', id: 'a/one' },
            mapId: 'map-1',
            ticketId: 'ticket-2',
          },
          stage: 'classification',
        },
      },
      {
        name: 'override stage',
        result: {
          type: 'automation-override-started',
          target: {
            project: { integration: 'github', id: 'a/one' },
            mapId: 'map-1',
            ticketId: 'ticket-1',
          },
          stage: 'wayfinder',
        },
      },
    ],
  },
]

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

  it('accepts independently observable Automation evidence', () => {
    const { store, sockets } = harness()
    store.start()
    const next = state(1)
    next.automation.evidence = [
      {
        target: {
          project: { integration: 'github', id: 'asmundwien/roadmap' },
          mapId: '81',
          ticketId: '82',
        },
        classification: {
          status: 'completed',
          admission: 'override',
          processResult: { status: 'exited', code: 0 },
          verdict: { value: 'afk', reason: 'Ready.' },
        },
        wayfinder: {
          status: 'finished',
          admission: 'automatic',
          processResult: { status: 'signaled', signal: 'SIGTERM' },
          report: {
            status: 'received',
            report: { outcome: 'completed', reason: 'Ticket resolved.' },
          },
        },
      },
    ]

    sockets[0]?.emit('message', wire(next))

    expect(store.getSnapshot().state?.automation.evidence).toEqual(next.automation.evidence)
  })

  it('rejects contradictory fields in Automation evidence', () => {
    const { store, sockets } = harness()
    store.start()
    sockets[0]?.emit('message', wire(state(1)))
    const invalid = state(2)
    sockets[0]?.emit(
      'message',
      JSON.stringify({
        type: 'state',
        state: {
          ...invalid,
          automation: {
            ...invalid.automation,
            evidence: [
              {
                target: {
                  project: { integration: 'local', id: 'invalid' },
                  mapId: 'map',
                  ticketId: 'ticket',
                },
                classification: {
                  status: 'running',
                  admission: 'automatic',
                  verdict: { value: 'afk', reason: 'Impossible while running.' },
                },
              },
            ],
          },
        },
      }),
    )

    expect(store.getSnapshot().state?.stateSequence).toBe(1)
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
    response.resolve(jsonResponse({ type: 'command-result', outcome }))
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

  it('does not expose thrown transport secrets in command activity', async () => {
    const { store } = harness(async () => {
      throw new Error('private-token')
    })
    await expect(
      store.execute({
        type: 'launch-action',
        expectedConfigurationVersion: 1,
        actionId: 'action-1',
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(store.getSnapshot().command.error?.message).not.toContain('private-token')
    expect(store.getSnapshot().command.error?.code).toBe('transport-failed')
  })

  it.each(rejectionPolicies)(
    'distinguishes attributable command rejection from uncertain completion ($reason)',
    async ({ reason, status }) => {
      let attempts = 0
      let requestId: string | null = null
      let redirect: RequestRedirect | undefined
      const fetchRequest: typeof fetch = async (_input, init) => {
        attempts += 1
        requestId = new Headers(init?.headers).get('X-Roadmap-Request-Id')
        redirect = init?.redirect
        return jsonResponse(requestRejection('command', requestId, reason), status)
      }
      const { store, sockets } = harness(fetchRequest)
      store.start()
      sockets[0]?.emit('message', wire(state(1, 'epoch-a', [project('retained')])))
      const retainedState = store.getSnapshot().state

      const delivery = await store.execute({
        type: 'refresh-project',
        expectedConfigurationVersion: 1,
        project: { integration: 'github', id: 'a/one' },
      })

      expect(delivery).toMatchObject({
        kind: 'not-admitted',
        ok: false,
        rejection: {
          type: 'request-rejected',
          request: 'command',
          requestId,
          reason,
        },
        error: { code: 'admission-failed' },
      })
      expect(delivery).not.toHaveProperty('state')
      expect(delivery).not.toHaveProperty('outcome')
      expect(store.getSnapshot().state).toBe(retainedState)
      expect(store.getSnapshot().command).toMatchObject({
        inFlight: false,
        error: { code: 'admission-failed' },
      })
      if (!delivery.ok) {
        expect(delivery.error.message.trim()).not.toBe('')
        expect(store.getSnapshot().command.error).toEqual(delivery.error)
      }
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
      expect(redirect).toBe('error')
      expect(attempts).toBe(1)
    },
  )

  it.each(rejectionPolicies)(
    'returns attributable query rejection without fabricating application state ($reason)',
    async ({ reason, status }) => {
      let attempts = 0
      let requestId: string | null = null
      let redirect: RequestRedirect | undefined
      const fetchRequest: typeof fetch = async (_input, init) => {
        attempts += 1
        requestId = new Headers(init?.headers).get('X-Roadmap-Request-Id')
        redirect = init?.redirect
        return jsonResponse(requestRejection('query', requestId, reason), status)
      }
      const { store, sockets } = harness(fetchRequest)
      store.start()
      sockets[0]?.emit('message', wire(state(1)))
      const retainedState = store.getSnapshot().state

      const delivery = await store.query({ type: 'select-workspace' })

      expect(delivery).toMatchObject({
        kind: 'not-admitted',
        ok: false,
        rejection: { type: 'request-rejected', request: 'query', requestId, reason },
        error: { code: 'admission-failed' },
      })
      expect(delivery).not.toHaveProperty('state')
      expect(delivery).not.toHaveProperty('outcome')
      if (!delivery.ok) {
        expect(delivery.error.message.trim()).not.toBe('')
      }
      expect(store.getSnapshot().state).toBe(retainedState)
      expect(store.getSnapshot().command).toEqual({ inFlight: false, error: null })
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
      expect(redirect).toBe('error')
      expect(attempts).toBe(1)
    },
  )

  it('keeps command completion unknown for a valid application envelope on HTTP 500', async () => {
    const outcome: CommandOutcome = {
      ok: true,
      result: { type: 'project-refreshed', project: { integration: 'github', id: 'a/one' } },
      state: state(99),
    }
    let attempts = 0
    const fetchRequest: typeof fetch = async () => {
      attempts += 1
      return jsonResponse({ type: 'command-result', outcome }, 500)
    }
    const { store, sockets } = harness(fetchRequest)
    store.start()
    sockets[0]?.emit('message', wire(state(1)))
    const retainedState = store.getSnapshot().state

    await expect(
      store.execute({
        type: 'refresh-project',
        expectedConfigurationVersion: 1,
        project: { integration: 'github', id: 'a/one' },
      }),
    ).rejects.toBeInstanceOf(Error)

    expect(store.getSnapshot().state).toBe(retainedState)
    expect(store.getSnapshot().command).toMatchObject({
      inFlight: false,
      error: { code: 'transport-failed' },
    })
    expect(attempts).toBe(1)
  })

  it('keeps query completion uncertain for a valid application envelope on HTTP 500', async () => {
    const result: QueryResult = {
      ok: true,
      type: 'workspace-selection',
      path: '/selected/workspace',
    }
    let attempts = 0
    const fetchRequest: typeof fetch = async () => {
      attempts += 1
      return jsonResponse({ type: 'query-result', result }, 500)
    }
    const { store, sockets } = harness(fetchRequest)
    store.start()
    sockets[0]?.emit('message', wire(state(1)))
    const retainedState = store.getSnapshot().state

    const delivery = await store.query({ type: 'select-workspace' })

    expect(delivery).toMatchObject({ ok: false, error: { code: 'transport-failed' } })
    expect(delivery).not.toHaveProperty('kind', 'not-admitted')
    expect(store.getSnapshot().state).toBe(retainedState)
    expect(store.getSnapshot().command).toEqual({ inFlight: false, error: null })
    expect(attempts).toBe(1)
  })

  it.each(uncertainReplies)(
    'keeps command completion unknown for $name without replaying or replacing state',
    async ({ status, body }) => {
      let attempts = 0
      const fetchRequest: typeof fetch = async (_input, init) => {
        attempts += 1
        const requestId = new Headers(init?.headers).get('X-Roadmap-Request-Id')
        return jsonResponse(body(requestId, 'command'), status)
      }
      const { store, sockets } = harness(fetchRequest)
      store.start()
      sockets[0]?.emit('message', wire(state(1)))
      const retainedState = store.getSnapshot().state

      await expect(
        store.execute({
          type: 'refresh-project',
          expectedConfigurationVersion: 1,
          project: { integration: 'github', id: 'a/one' },
        }),
      ).rejects.toBeInstanceOf(Error)

      expect(store.getSnapshot().state).toBe(retainedState)
      expect(store.getSnapshot().command).toMatchObject({
        inFlight: false,
        error: { code: 'transport-failed' },
      })
      expect(attempts).toBe(1)
    },
  )

  it.each(uncertainReplies)(
    'keeps query failure uncertain for $name without replaying or replacing state',
    async ({ status, body }) => {
      let attempts = 0
      const fetchRequest: typeof fetch = async (_input, init) => {
        attempts += 1
        const requestId = new Headers(init?.headers).get('X-Roadmap-Request-Id')
        return jsonResponse(body(requestId, 'query'), status)
      }
      const { store, sockets } = harness(fetchRequest)
      store.start()
      sockets[0]?.emit('message', wire(state(1)))
      const retainedState = store.getSnapshot().state

      const result = await store.query({ type: 'select-workspace' })

      expect(result).toMatchObject({ ok: false, error: { code: 'transport-failed' } })
      expect(result).not.toHaveProperty('kind', 'not-admitted')
      expect(store.getSnapshot().state).toBe(retainedState)
      expect(store.getSnapshot().command).toEqual({ inFlight: false, error: null })
      expect(attempts).toBe(1)
    },
  )

  it.each(unreadableReplies)(
    'keeps command completion unknown after $name without replaying',
    async ({ respond }) => {
      let attempts = 0
      const fetchRequest: typeof fetch = async () => {
        attempts += 1
        return respond()
      }
      const { store, sockets } = harness(fetchRequest)
      store.start()
      sockets[0]?.emit('message', wire(state(1)))
      const retainedState = store.getSnapshot().state

      await expect(
        store.execute({
          type: 'refresh-project',
          expectedConfigurationVersion: 1,
          project: { integration: 'github', id: 'a/one' },
        }),
      ).rejects.toBeInstanceOf(Error)

      expect(store.getSnapshot().state).toBe(retainedState)
      expect(store.getSnapshot().command).toMatchObject({
        inFlight: false,
        error: { code: 'transport-failed' },
      })
      expect(attempts).toBe(1)
    },
  )

  it.each(unreadableReplies)(
    'returns query transport failure after $name without replaying',
    async ({ respond }) => {
      let attempts = 0
      const fetchRequest: typeof fetch = async () => {
        attempts += 1
        return respond()
      }
      const { store, sockets } = harness(fetchRequest)
      store.start()
      sockets[0]?.emit('message', wire(state(1)))
      const retainedState = store.getSnapshot().state

      await expect(store.query({ type: 'select-workspace' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'transport-failed' },
      })

      expect(store.getSnapshot().state).toBe(retainedState)
      expect(store.getSnapshot().command).toEqual({ inFlight: false, error: null })
      expect(attempts).toBe(1)
    },
  )

  for (const { name, command, result, mismatches } of commandResultPairs) {
    it(`accepts the matching successful result for ${name}`, async () => {
      let attempts = 0
      const outcome: CommandOutcome = { ok: true, result, state: state(2) }
      const fetchRequest: typeof fetch = async () => {
        attempts += 1
        return jsonResponse({ type: 'command-result', outcome })
      }
      const { store, sockets } = harness(fetchRequest)
      store.start()
      sockets[0]?.emit('message', wire(state(1)))

      await expect(store.execute(command)).resolves.toEqual(outcome)

      expect(store.getSnapshot().state?.stateSequence).toBe(2)
      expect(store.getSnapshot().command).toEqual({ inFlight: false, error: null })
      expect(attempts).toBe(1)
    })

    it.each(mismatches)(
      `rejects a successful ${name} result with the wrong $name without replacing state`,
      async ({ result: wrongResult }) => {
        let attempts = 0
        const outcome: CommandOutcome = { ok: true, result: wrongResult, state: state(99) }
        const fetchRequest: typeof fetch = async () => {
          attempts += 1
          return jsonResponse({ type: 'command-result', outcome })
        }
        const { store, sockets } = harness(fetchRequest)
        store.start()
        sockets[0]?.emit('message', wire(state(1)))
        const retainedState = store.getSnapshot().state

        await expect(store.execute(command)).rejects.toBeInstanceOf(Error)

        expect(store.getSnapshot().state).toBe(retainedState)
        expect(store.getSnapshot().command).toMatchObject({
          inFlight: false,
          error: { code: 'transport-failed' },
        })
        expect(attempts).toBe(1)
      },
    )
  }

  it('uses a fresh request UUID for each explicit attempt without automatically replaying rejection', async () => {
    const requestIds: (string | null)[] = []
    const fetchRequest: typeof fetch = async (input, init) => {
      const requestId = new Headers(init?.headers).get('X-Roadmap-Request-Id')
      requestIds.push(requestId)
      const request = String(input).endsWith('/api/query') ? 'query' : 'command'
      return jsonResponse(requestRejection(request, requestId), 403)
    }
    const { store, sockets } = harness(fetchRequest)
    store.start()
    sockets[0]?.emit('message', wire(state(1)))
    const retainedState = store.getSnapshot().state
    const command: Parameters<typeof store.execute>[0] = {
      type: 'refresh-project',
      expectedConfigurationVersion: 1,
      project: { integration: 'github', id: 'a/one' },
    }

    await expect(store.execute(command)).resolves.toMatchObject({ kind: 'not-admitted' })
    await expect(store.execute(command)).resolves.toMatchObject({ kind: 'not-admitted' })
    await expect(store.query({ type: 'select-workspace' })).resolves.toMatchObject({
      kind: 'not-admitted',
    })

    expect(requestIds).toHaveLength(3)
    expect(requestIds).not.toContain(null)
    expect(new Set(requestIds).size).toBe(3)
    expect(store.getSnapshot().state).toBe(retainedState)
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
