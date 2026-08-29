import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type {
  ApplicationState,
  Command,
  CommandOutcome,
  Query,
  QueryResult,
} from '@roadmap/contracts'
import {
  commandEnvelopeCodec,
  commandResultEnvelopeCodec,
  queryEnvelopeCodec,
  stateEnvelopeCodec,
} from '@roadmap/contracts/codecs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { RoadmapApplication } from './application/application.ts'
import { createRoadmapTransport, type RoadmapTransport } from './transport.ts'

const ALLOWED_ORIGIN = 'http://localhost:5173'

function state(stateSequence: number, serverEpoch = 'epoch-a'): ApplicationState {
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
    roadmap: { capturedAt: stateSequence * 1000, projects: [], unreachable: [] },
  }
}

interface ApplicationHarness {
  application: RoadmapApplication
  publish(next: ApplicationState): void
  query: ReturnType<typeof vi.fn<(query: Query) => Promise<QueryResult>>>
  execute: ReturnType<typeof vi.fn<(command: Command) => Promise<CommandOutcome>>>
}

function applicationHarness(initial = state(0)): ApplicationHarness {
  let current = initial
  const listeners = new Set<(value: ApplicationState) => void>()
  const query = vi.fn(
    async (_request: Query): Promise<QueryResult> => ({
      ok: true,
      type: 'workspace-selection',
    }),
  )
  const execute = vi.fn(async (_command: Command): Promise<CommandOutcome> => {
    const next = state(current.stateSequence + 1, current.serverEpoch)
    current = next
    for (const listener of listeners) listener(next)
    return {
      ok: true,
      result: { type: 'configuration-updated', configurationVersion: 1 },
      state: next,
    }
  })
  return {
    application: {
      start: async () => undefined,
      current: () => current,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      query,
      execute,
      stop: async () => undefined,
    },
    publish(next) {
      current = next
      for (const listener of listeners) listener(next)
    },
    query,
    execute,
  }
}

interface TransportHarness {
  server: Server
  transport: RoadmapTransport
  application: ApplicationHarness
  httpUrl: string
  wsUrl: string
}

const running: TransportHarness[] = []

async function transportHarness(
  application = applicationHarness(),
  maxBodyBytes?: number,
): Promise<TransportHarness> {
  let transport: RoadmapTransport | null = null
  const server = createServer((request, response) => {
    if (transport?.handle(request, response)) return
    response.writeHead(404).end()
  })
  transport = createRoadmapTransport({
    server,
    application: application.application,
    allowedOrigin: ALLOWED_ORIGIN,
    ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const harness = {
    server,
    transport,
    application,
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
  }
  running.push(harness)
  return harness
}

afterEach(async () => {
  while (running.length > 0) {
    const harness = running.pop()
    harness?.transport.close()
    if (harness?.server.listening) {
      await new Promise<void>((resolve) => harness.server.close(() => resolve()))
    }
  }
})

async function openSocket(url: string): Promise<{ socket: WebSocket; first: ApplicationState }> {
  const socket = new WebSocket(url, { headers: { Origin: ALLOWED_ORIGIN } })
  const firstMessage = once(socket, 'message')
  await once(socket, 'open')
  const [data] = await firstMessage
  const decoded = stateEnvelopeCodec.decode(JSON.parse(String(data)) as unknown)
  if (!decoded.ok) throw new Error('invalid state envelope in test')
  return { socket, first: decoded.value.state }
}

function post(url: string, body: unknown, origin = ALLOWED_ORIGIN): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('transport codecs', () => {
  it('strictly rejects malformed state, query, command, and result envelopes', () => {
    expect(
      stateEnvelopeCodec.decode({ type: 'state', state: { ...state(1), token: 'secret' } }).ok,
    ).toBe(false)
    expect(
      queryEnvelopeCodec.decode({
        type: 'query',
        query: { type: 'select-workspace', token: 'secret' },
      }).ok,
    ).toBe(false)
    expect(
      commandEnvelopeCodec.decode({
        type: 'command',
        command: {
          type: 'launch-action',
          expectedConfigurationVersion: 1,
          actionId: 'open-workspace',
          executable: '/bin/sh',
        },
      }).ok,
    ).toBe(false)
    expect(
      commandResultEnvelopeCodec.decode({
        type: 'command-result',
        outcome: { ok: true, result: { type: 'action-launched', actionId: 'open' } },
      }).ok,
    ).toBe(false)
  })
})
describe('Automation override transport', () => {
  it('accepts strict stage commands and echoed start results', () => {
    const target = {
      project: { integration: 'github' as const, id: 'example/project' },
      mapId: '1',
      ticketId: '2',
    }
    expect(
      commandEnvelopeCodec.decode({
        type: 'command',
        command: {
          type: 'start-automation-override',
          expectedConfigurationVersion: 1,
          target,
          stage: 'classification',
        },
      }),
    ).toMatchObject({ ok: true })
    expect(
      commandResultEnvelopeCodec.decode({
        type: 'command-result',
        outcome: {
          ok: true,
          result: { type: 'automation-override-started', target, stage: 'classification' },
          state: state(1),
        },
      }),
    ).toMatchObject({ ok: true })
  })
})

describe('createRoadmapTransport', () => {
  it('replays current state to late clients and broadcasts full replacements', async () => {
    const harness = await transportHarness()
    const first = await openSocket(harness.wsUrl)
    expect(first.first.stateSequence).toBe(0)

    const nextMessage = once(first.socket, 'message')
    harness.application.publish(state(1))
    const [data] = await nextMessage
    const decoded = stateEnvelopeCodec.decode(JSON.parse(String(data)) as unknown)
    expect(decoded.ok && decoded.value.state.stateSequence).toBe(1)
    first.socket.close()
    await once(first.socket, 'close')

    const late = await openSocket(harness.wsUrl)
    expect(late.first.stateSequence).toBe(1)
    late.socket.close()
  })

  it('rejects wrong HTTP and WebSocket origins without wildcard CORS', async () => {
    const harness = await transportHarness()
    const response = await post(
      `${harness.httpUrl}/api/query`,
      { type: 'query', query: { type: 'select-workspace' } },
      'http://attacker.example',
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()

    const socket = new WebSocket(harness.wsUrl, {
      headers: { Origin: 'http://attacker.example' },
    })
    socket.on('error', () => undefined)
    const [, rejected] = await once(socket, 'unexpected-response')
    expect(rejected.statusCode).toBe(403)
    socket.terminate()
  })

  it('handles typed queries without publishing their result', async () => {
    const harness = await transportHarness()
    const connected = await openSocket(harness.wsUrl)
    let messages = 0
    connected.socket.on('message', () => {
      messages += 1
    })

    const response = await post(`${harness.httpUrl}/api/query`, {
      type: 'query',
      query: { type: 'select-workspace' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      type: 'query-result',
      result: { ok: true, type: 'workspace-selection' },
    })
    expect(harness.application.query).toHaveBeenCalledOnce()
    expect(messages).toBe(0)
    connected.socket.close()
  })

  it('publishes command state before returning the exact same authoritative state', async () => {
    const harness = await transportHarness()
    const connected = await openSocket(harness.wsUrl)
    const events: string[] = []
    const published = new Promise<void>((resolve) => {
      connected.socket.once('message', () => {
        events.push('published')
        resolve()
      })
    })

    const responsePromise = post(`${harness.httpUrl}/api/command`, {
      type: 'command',
      command: {
        type: 'rename-connection',
        expectedConfigurationVersion: 1,
        connectionId: 'one',
        name: 'Renamed',
      },
    }).then(async (response) => {
      events.push('responded')
      return response.json() as Promise<unknown>
    })

    await published
    const response = await responsePromise
    const decoded = commandResultEnvelopeCodec.decode(response)
    expect(decoded.ok && decoded.value.outcome.state.stateSequence).toBe(1)
    expect(events).toEqual(['published', 'responded'])
    connected.socket.close()
  })

  it('preserves typed stale-configuration conflicts with authoritative state', async () => {
    const application = applicationHarness(state(7))
    application.execute.mockResolvedValue({
      ok: false,
      error: { code: 'conflict', message: 'Configuration changed.' },
      state: state(7),
    })
    const harness = await transportHarness(application)
    const response = await post(`${harness.httpUrl}/api/command`, {
      type: 'command',
      command: {
        type: 'remove-connection',
        expectedConfigurationVersion: 0,
        connectionId: 'one',
      },
    })
    const decoded = commandResultEnvelopeCodec.decode(await response.json())
    expect(decoded.ok && decoded.value.outcome).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
      state: { stateSequence: 7 },
    })
  })

  it('rejects malformed and oversized JSON before calling the application', async () => {
    const harness = await transportHarness(applicationHarness(), 128)
    const malformed = await post(`${harness.httpUrl}/api/query`, '{')
    expect(malformed.status).toBe(400)
    expect(harness.application.query).not.toHaveBeenCalled()

    const oversized = await post(`${harness.httpUrl}/api/command`, {
      type: 'command',
      padding: 'x'.repeat(256),
    })
    expect(oversized.status).toBe(413)
    expect(harness.application.execute).not.toHaveBeenCalled()
  })

  it('does not serialize credentials from a malformed application state', async () => {
    const unsafe = state(0) as ApplicationState & { token: string }
    unsafe.token = 'never-cross-the-wire'
    const harness = await transportHarness(applicationHarness(unsafe))
    const response = await post(`${harness.httpUrl}/api/command`, '{')
    const body = await response.text()
    expect(response.status).toBe(500)
    expect(body).not.toContain('never-cross-the-wire')
    expect(body).toContain('Internal transport error')
  })
})
