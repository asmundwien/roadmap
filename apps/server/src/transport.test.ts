import { once } from 'node:events'
import {
  type ClientRequest,
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { createConnection, type Socket } from 'node:net'
import { inspect } from 'node:util'
import type {
  ApplicationState,
  Command,
  CommandOutcome,
  Query,
  QueryResult,
} from '@roadmap/contracts'
import { commandResultEnvelopeCodec, stateEnvelopeCodec } from '@roadmap/contracts/codecs'
import { decodeCommandEnvelope, decodeQueryEnvelope } from '@roadmap/contracts/wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { RoadmapApplication } from './application/application.ts'
import { createRoadmapTransport, type RoadmapTransport } from './transport.ts'

const ALLOWED_ORIGIN = 'http://localhost:5173'
const REQUEST_ID = '27cc82a7-2fef-4f63-b5d4-842d12f3afc4'
const VALID_QUERY = { type: 'query', query: { type: 'select-workspace' } }
const VALID_COMMAND = {
  type: 'command',
  command: {
    type: 'remove-connection',
    expectedConfigurationVersion: 1,
    connectionId: 'one',
  },
}

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

const clients = new Set<ClientRequest | Socket>()
async function transportHarness(
  application = applicationHarness(),
  maxBodyBytes?: number,
  beforeHandle?: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<TransportHarness> {
  let transport: RoadmapTransport | null = null
  const server = createServer((request, response) => {
    beforeHandle?.(request, response)
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
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing HTTP address')
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
  for (const client of clients) client.destroy()
  clients.clear()
  while (running.length > 0) {
    const harness = running.pop()
    harness?.transport.close()
    if (harness?.server.listening) {
      harness.server.closeAllConnections()
      await new Promise<void>((resolve) => harness.server.close(() => resolve()))
    }
  }
  vi.restoreAllMocks()
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

function post(
  url: string,
  body: unknown,
  origin = ALLOWED_ORIGIN,
  requestId: string | null = REQUEST_ID,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(requestId === null ? {} : { 'X-Roadmap-Request-Id': requestId }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('transport did not terminate promptly')), 2000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function pendingPost(
  url: string,
  extraHeaders: Record<string, string | undefined> = {},
  method = 'POST',
) {
  const request = httpRequest(url, {
    method,
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Content-Type': 'application/json',
      'X-Roadmap-Request-Id': REQUEST_ID,
      ...extraHeaders,
    },
  })
  clients.add(request)
  const closed = new Promise<void>((resolve) => {
    request.once('socket', (socket) => socket.once('close', () => resolve()))
  })
  const response = new Promise<{
    status: number | undefined
    headers: IncomingHttpHeaders
    body: string
  }>((resolve, reject) => {
    request.on('error', reject)
    request.once('response', (reply) => {
      const chunks: Buffer[] = []
      reply.on('data', (chunk: Buffer) => chunks.push(chunk))
      reply.once('error', reject)
      reply.once('end', () => {
        resolve({
          status: reply.statusCode,
          headers: reply.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
  })
  return { request, response, closed }
}

function expectNoAdmission(harness: TransportHarness): void {
  expect(harness.application.query).not.toHaveBeenCalled()
  expect(harness.application.execute).not.toHaveBeenCalled()
}

async function expectRecovery(harness: TransportHarness): Promise<void> {
  const response = await bounded(post(`${harness.httpUrl}/api/query`, VALID_QUERY))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    type: 'query-result',
    result: { ok: true, type: 'workspace-selection' },
  })
}

describe('transport codecs', () => {
  it('strictly rejects malformed state, query, command, and result envelopes', () => {
    expect(
      stateEnvelopeCodec.decode({ type: 'state', state: { ...state(1), token: 'secret' } }).ok,
    ).toBe(false)
    expect(
      decodeQueryEnvelope({
        type: 'query',
        query: { type: 'select-workspace', token: 'secret' },
      }).ok,
    ).toBe(false)
    expect(
      decodeCommandEnvelope({
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
      decodeCommandEnvelope({
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

  it('returns the shared rejection envelope for malformed command JSON without fabricated state', async () => {
    const harness = await transportHarness()
    const current = vi.spyOn(harness.application.application, 'current')
    const response = await post(`${harness.httpUrl}/api/command`, '{')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      type: 'request-rejected',
      request: 'command',
      requestId: REQUEST_ID,
      reason: 'malformed-json',
      message: expect.any(String),
    })
    expectNoAdmission(harness)
    expect(current).not.toHaveBeenCalled()
  })

  it.each([
    {
      request: 'query',
      reason: 'origin',
      status: 403,
      origin: 'http://attacker.example',
      method: 'POST',
      mediaType: 'application/json',
    },
    {
      request: 'command',
      reason: 'origin',
      status: 403,
      origin: 'http://attacker.example',
      method: 'POST',
      mediaType: 'application/json',
    },
    {
      request: 'query',
      reason: 'method',
      status: 405,
      origin: ALLOWED_ORIGIN,
      method: 'GET',
      mediaType: 'application/json',
    },
    {
      request: 'command',
      reason: 'method',
      status: 405,
      origin: ALLOWED_ORIGIN,
      method: 'GET',
      mediaType: 'application/json',
    },
    {
      request: 'query',
      reason: 'media-type',
      status: 415,
      origin: ALLOWED_ORIGIN,
      method: 'POST',
      mediaType: 'text/plain',
    },
    {
      request: 'command',
      reason: 'media-type',
      status: 415,
      origin: ALLOWED_ORIGIN,
      method: 'POST',
      mediaType: 'text/plain',
    },
  ])(
    'rejects $request admission for $reason with an attributed wire envelope',
    async ({ request, reason, status, origin, method, mediaType }) => {
      const harness = await transportHarness()
      const response = await fetch(`${harness.httpUrl}/api/${request}`, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': mediaType,
          'X-Roadmap-Request-Id': REQUEST_ID,
        },
      })
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({
        type: 'request-rejected',
        request,
        requestId: REQUEST_ID,
        reason,
        message: expect.any(String),
      })
      expect(response.headers.get('access-control-allow-origin')).toBe(
        reason === 'origin' ? null : ALLOWED_ORIGIN,
      )
      if (reason === 'method') expect(response.headers.get('allow')).toContain('POST')
      expectNoAdmission(harness)
    },
  )

  it.each([
    { request: 'query', body: '{', reason: 'malformed-json' },
    { request: 'query', body: 'null', reason: 'malformed-envelope' },
    { request: 'query', body: '[]', reason: 'malformed-envelope' },
    { request: 'query', body: '{}', reason: 'malformed-envelope' },
    {
      request: 'query',
      body: { type: 'command', command: VALID_COMMAND.command },
      reason: 'malformed-envelope',
    },
    {
      request: 'query',
      body: { ...VALID_QUERY, token: 'input-must-not-leak' },
      reason: 'malformed-envelope',
    },
    {
      request: 'query',
      body: { type: 'query', query: { type: 'select-workspace', token: 'input-must-not-leak' } },
      reason: 'malformed-envelope',
    },
    { request: 'query', body: { type: 'query', query: {} }, reason: 'malformed-envelope' },
    { request: 'command', body: 'null', reason: 'malformed-envelope' },
    {
      request: 'command',
      body: { type: 'query', query: VALID_QUERY.query },
      reason: 'malformed-envelope',
    },
    {
      request: 'command',
      body: { ...VALID_COMMAND, token: 'input-must-not-leak' },
      reason: 'malformed-envelope',
    },
    {
      request: 'command',
      body: {
        type: 'command',
        command: { ...VALID_COMMAND.command, token: 'input-must-not-leak' },
      },
      reason: 'malformed-envelope',
    },
    {
      request: 'command',
      body: { type: 'command', command: { type: 'remove-connection', connectionId: 'one' } },
      reason: 'malformed-envelope',
    },
    {
      request: 'command',
      body: {
        type: 'command',
        command: { ...VALID_COMMAND.command, expectedConfigurationVersion: '1' },
      },
      reason: 'malformed-envelope',
    },
    {
      request: 'command',
      body: {
        type: 'command',
        command: { ...VALID_COMMAND.command, expectedConfigurationVersion: -1 },
      },
      reason: 'malformed-envelope',
    },
    {
      request: 'command',
      body: {
        type: 'command',
        command: {
          type: 'register-project',
          expectedConfigurationVersion: 1,
          candidate: {
            integration: 'github',
            connectionId: 'one',
            workspace: { path: '/tmp/project' },
            token: 'input-must-not-leak',
          },
        },
      },
      reason: 'malformed-envelope',
    },
    {
      request: 'command',
      body: {
        type: 'command',
        command: {
          type: 'register-project',
          expectedConfigurationVersion: 1,
          candidate: {
            integration: 'github',
            connectionId: 'one',
            workspace: { path: '/tmp/project', token: 'input-must-not-leak' },
          },
        },
      },
      reason: 'malformed-envelope',
    },
    {
      request: 'command',
      body: {
        type: 'command',
        command: {
          type: 'repair-project-workspace',
          expectedConfigurationVersion: 1,
          project: { integration: 'github', id: 'example/project' },
          workspace: { path: '/tmp/project', token: 'input-must-not-leak' },
        },
      },
      reason: 'malformed-envelope',
    },
  ])(
    'rejects strict $request input before admission ($reason, %#)',
    async ({ request, body, reason }) => {
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const harness = await transportHarness()
      const response = await post(`${harness.httpUrl}/api/${request}`, body)
      const text = await response.text()
      expect(response.status).toBe(400)
      expect(JSON.parse(text)).toEqual({
        type: 'request-rejected',
        request,
        requestId: REQUEST_ID,
        reason,
        message: expect.any(String),
      })
      expect(text).not.toContain('input-must-not-leak')
      expect(inspect(diagnostics.mock.calls)).not.toContain('input-must-not-leak')
      expectNoAdmission(harness)
    },
  )

  it.each([null, 'invalid-correlation-secret', `${REQUEST_ID}, ${REQUEST_ID}`])(
    'does not echo missing or invalid request correlation (%s)',
    async (requestId) => {
      const harness = await transportHarness()
      const response = await post(`${harness.httpUrl}/api/query`, '{', ALLOWED_ORIGIN, requestId)
      const text = await response.text()
      expect(response.status).toBe(400)
      expect(JSON.parse(text)).toEqual({
        type: 'request-rejected',
        request: 'query',
        requestId: null,
        reason: 'malformed-json',
        message: expect.any(String),
      })
      expect(text).not.toContain('invalid-correlation-secret')
      expectNoAdmission(harness)
    },
  )

  it('admits supported nonbrowser requests without correlation', async () => {
    const harness = await transportHarness()
    const query = await post(`${harness.httpUrl}/api/query`, VALID_QUERY, ALLOWED_ORIGIN, null)
    expect(query.status).toBe(200)
    expect(await query.json()).toEqual({
      type: 'query-result',
      result: { ok: true, type: 'workspace-selection' },
    })
    const command = await post(
      `${harness.httpUrl}/api/command`,
      VALID_COMMAND,
      ALLOWED_ORIGIN,
      null,
    )
    expect(command.status).toBe(200)
    expect(commandResultEnvelopeCodec.decode(await command.json()).ok).toBe(true)
    expect(harness.application.query).toHaveBeenCalledOnce()
    expect(harness.application.execute).toHaveBeenCalledOnce()
  })

  it.each(['query', 'command'])(
    'allows the correlation header in %s CORS preflight without admission',
    async (request) => {
      const harness = await transportHarness()
      const response = await fetch(`${harness.httpUrl}/api/${request}`, {
        method: 'OPTIONS',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-roadmap-request-id',
        },
      })
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN)
      const headers = response.headers
        .get('access-control-allow-headers')
        ?.toLowerCase()
        .split(',')
        .map((header) => header.trim())
      expect(headers).toContain('content-type')
      expect(headers).toContain('x-roadmap-request-id')
      expect(await response.text()).toBe('')
      expectNoAdmission(harness)
    },
  )

  it('denies nonloopback command admission while permitting a query from that peer', async () => {
    const harness = await transportHarness(applicationHarness(), undefined, (request) => {
      // A real HTTP socket with controlled peer metadata avoids dependence on a host network interface.
      Object.defineProperty(request.socket, 'remoteAddress', {
        value: '192.0.2.20',
        configurable: true,
      })
    })
    const response = await post(`${harness.httpUrl}/api/command`, VALID_COMMAND)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      type: 'request-rejected',
      request: 'command',
      requestId: REQUEST_ID,
      reason: 'peer',
      message: expect.any(String),
    })
    expectNoAdmission(harness)
    await expectRecovery(harness)
    expect(harness.application.query).toHaveBeenCalledOnce()
    expect(harness.application.execute).not.toHaveBeenCalled()
  })
})

describe('bounded ingress lifecycle regressions after repair', () => {
  it.each([
    { request: 'query', variant: '__proto__' },
    { request: 'command', variant: '__proto__' },
    { request: 'query', variant: 'constructor' },
    { request: 'command', variant: 'constructor' },
    { request: 'query', variant: 'toString' },
    { request: 'command', variant: 'toString' },
    { request: 'query', variant: 'unsupported-operation' },
    { request: 'command', variant: 'unsupported-operation' },
  ])(
    'rejects inherited or unsupported $request variant $variant without dispatch',
    async ({ request, variant }) => {
      const harness = await transportHarness()
      const response = await bounded(
        post(`${harness.httpUrl}/api/${request}`, {
          type: request,
          [request]: { type: variant },
        }),
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        type: 'request-rejected',
        request,
        requestId: REQUEST_ID,
        reason: 'malformed-envelope',
        message: expect.any(String),
      })
      expectNoAdmission(harness)
      await expectRecovery(harness)
      expect(harness.application.query).toHaveBeenCalledOnce()
      expect(harness.application.execute).not.toHaveBeenCalled()
    },
  )

  it.each(['query', 'command'])(
    'closes a declared oversized %s upload before any body is sent',
    async (request) => {
      const harness = await transportHarness()
      const upload = pendingPost(`${harness.httpUrl}/api/${request}`, { 'Content-Length': '65537' })
      upload.request.flushHeaders()
      const response = await bounded(upload.response)
      expect(upload.request.writableEnded).toBe(false)
      expect(response.status).toBe(413)
      expect(response.headers.connection).toBe('close')
      expect(JSON.parse(response.body)).toEqual({
        type: 'request-rejected',
        request,
        requestId: REQUEST_ID,
        reason: 'too-large',
        message: expect.any(String),
      })
      await bounded(upload.closed)
      expectNoAdmission(harness)
      await expectRecovery(harness)
    },
  )

  it.each(['query', 'command'])(
    'stops a streamed oversized %s upload without waiting for its end',
    async (request) => {
      const harness = await transportHarness(applicationHarness(), 128)
      const upload = pendingPost(`${harness.httpUrl}/api/${request}`)
      upload.request.write(' '.repeat(64))
      upload.request.write(' '.repeat(65))
      const response = await bounded(upload.response)
      expect(upload.request.writableEnded).toBe(false)
      expect(response.status).toBe(413)
      expect(response.headers.connection).toBe('close')
      expect(JSON.parse(response.body)).toEqual({
        type: 'request-rejected',
        request,
        requestId: REQUEST_ID,
        reason: 'too-large',
        message: expect.any(String),
      })
      await bounded(upload.closed)
      expectNoAdmission(harness)
      await expectRecovery(harness)
    },
  )

  it.each([
    { reason: 'origin', status: 403, headers: { Origin: 'http://attacker.example' }, peer: false },
    { reason: 'media-type', status: 415, headers: { 'Content-Type': 'text/plain' }, peer: false },
    { reason: 'peer', status: 403, headers: {}, peer: true },
    { reason: 'method', status: 405, headers: {}, peer: false },
  ])(
    'closes an unfinished upload rejected for $reason instead of draining it',
    async ({ reason, status, headers, peer }) => {
      const harness = await transportHarness(applicationHarness(), undefined, (request) => {
        if (peer)
          Object.defineProperty(request.socket, 'remoteAddress', {
            value: '192.0.2.20',
            configurable: true,
          })
      })
      const upload = pendingPost(
        `${harness.httpUrl}/api/command`,
        {
          'Content-Length': '9999999',
          ...headers,
        },
        reason === 'method' ? 'GET' : 'POST',
      )
      upload.request.write('body-that-never-finishes')
      const response = await bounded(upload.response)
      expect(upload.request.writableEnded).toBe(false)
      expect(response.status).toBe(status)
      expect(response.headers.connection).toBe('close')
      expect(JSON.parse(response.body)).toEqual({
        type: 'request-rejected',
        request: 'command',
        requestId: REQUEST_ID,
        reason,
        message: expect.any(String),
      })
      await bounded(upload.closed)
      expectNoAdmission(harness)
      await expectRecovery(harness)
    },
  )

  it('admits exactly the default 64 KiB body cap', async () => {
    const harness = await transportHarness()
    const envelope = JSON.stringify(VALID_QUERY)
    const response = await bounded(
      post(
        `${harness.httpUrl}/api/query`,
        envelope + ' '.repeat(65536 - Buffer.byteLength(envelope)),
      ),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      type: 'query-result',
      result: { ok: true, type: 'workspace-selection' },
    })
    expect(harness.application.query).toHaveBeenCalledOnce()
    expect(harness.application.execute).not.toHaveBeenCalled()
  })

  it.each(['query', 'command'])(
    'contains an interrupted %s body and admits a later valid request',
    async (request) => {
      let bodyInterrupted: (() => void) | undefined
      const interrupted = new Promise<void>((resolve) => {
        bodyInterrupted = resolve
      })
      const harness = await transportHarness(applicationHarness(), undefined, (incoming) => {
        incoming.once('aborted', () => bodyInterrupted?.())
      })
      const accepted = once(harness.server, 'request')
      const socket = createConnection({
        host: '127.0.0.1',
        port: Number(new URL(harness.httpUrl).port),
      })
      clients.add(socket)
      socket.on('error', () => undefined)
      await bounded(once(socket, 'connect'))
      socket.write(
        [
          `POST /api/${request} HTTP/1.1`,
          'Host: localhost',
          `Origin: ${ALLOWED_ORIGIN}`,
          'Content-Type: application/json',
          `X-Roadmap-Request-Id: ${REQUEST_ID}`,
          'Content-Length: 1000',
          '',
          '{"type":',
        ].join('\r\n'),
      )
      await bounded(accepted)
      socket.destroy()
      await bounded(interrupted)
      expectNoAdmission(harness)
      await expectRecovery(harness)
      expect(harness.application.query).toHaveBeenCalledOnce()
      expect(harness.application.execute).not.toHaveBeenCalled()
    },
  )

  it.each([
    { request: 'query', failure: 'throw' },
    { request: 'query', failure: 'reject' },
    { request: 'command', failure: 'throw' },
    { request: 'command', failure: 'reject' },
  ])(
    'contains an admitted $request application $failure without declaring non-admission',
    async ({ request, failure }) => {
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const application = applicationHarness()
      const defect = new Error('application-defect-secret')
      const operation = request === 'query' ? application.query : application.execute
      if (failure === 'throw')
        operation.mockImplementationOnce(() => {
          throw defect
        })
      else operation.mockRejectedValueOnce(defect)
      const harness = await transportHarness(application)
      const response = await bounded(
        post(
          `${harness.httpUrl}/api/${request}`,
          request === 'query' ? VALID_QUERY : VALID_COMMAND,
        ),
      )
      const body = await response.text()
      expect(response.status).toBe(500)
      expect(JSON.parse(body)).toEqual({ error: expect.any(String) })
      expect(body).not.toContain('application-defect-secret')
      expect(operation).toHaveBeenCalledOnce()
      expect(diagnostics).toHaveBeenCalled()
      expect(inspect(diagnostics.mock.calls)).not.toContain('application-defect-secret')
      await expectRecovery(harness)
    },
  )

  it('refuses unsafe output from an admitted command without exposing credentials', async () => {
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const application = applicationHarness()
    const unsafe = { ...state(1), token: 'never-cross-the-wire' }
    application.execute.mockResolvedValueOnce({
      ok: true,
      result: { type: 'configuration-updated', configurationVersion: 1 },
      state: unsafe,
    })
    const harness = await transportHarness(application)
    const response = await bounded(post(`${harness.httpUrl}/api/command`, VALID_COMMAND))
    const body = await response.text()
    expect(response.status).toBe(500)
    expect(JSON.parse(body)).toEqual({ error: expect.any(String) })
    expect(body).not.toContain('never-cross-the-wire')
    expect(application.execute).toHaveBeenCalledOnce()
    expect(application.query).not.toHaveBeenCalled()
    expect(diagnostics).toHaveBeenCalled()
    expect(inspect(diagnostics.mock.calls)).not.toContain('never-cross-the-wire')
    await expectRecovery(harness)
  })

  it.each(['__proto__', 'constructor', 'toString', 'unsupported-result'])(
    'contains an admitted query with inherited or unsupported output %s',
    async (variant) => {
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const application = applicationHarness()
      application.query.mockResolvedValueOnce(
        Object.assign({ ok: true, type: 'workspace-selection' } satisfies QueryResult, {
          type: variant,
        }),
      )
      const harness = await transportHarness(application)
      const response = await bounded(post(`${harness.httpUrl}/api/query`, VALID_QUERY))
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      expect(application.query).toHaveBeenCalledOnce()
      expect(application.execute).not.toHaveBeenCalled()
      expect(diagnostics).toHaveBeenCalled()
      await expectRecovery(harness)
    },
  )

  it.each([
    { failure: 'synchronous', admitted: false },
    { failure: 'asynchronous', admitted: false },
    { failure: 'synchronous', admitted: true },
    { failure: 'asynchronous', admitted: true },
    { failure: 'synchronous-end', admitted: false },
    { failure: 'synchronous-end', admitted: true },
  ])(
    'contains $failure response-write failure with admitted=$admitted and recovers',
    async ({ failure, admitted }) => {
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      let inject = true
      const harness = await transportHarness(
        applicationHarness(),
        undefined,
        (_request, response) => {
          if (!inject) return
          inject = false
          if (failure === 'synchronous') {
            vi.spyOn(response, 'writeHead').mockImplementationOnce(() => {
              throw new Error('response-write-secret')
            })
          } else if (failure === 'synchronous-end') {
            vi.spyOn(response, 'end').mockImplementationOnce(() => {
              throw new Error('response-write-secret')
            })
          } else {
            vi.spyOn(response, 'end').mockImplementationOnce(() => {
              queueMicrotask(() => {
                response.emit('error', new Error('response-write-secret'))
                response.destroy()
              })
              return response
            })
          }
        },
      )
      const result = await bounded(
        post(`${harness.httpUrl}/api/command`, admitted ? VALID_COMMAND : '{')
          .then(async (response) => ({
            status: response.status,
            body: await response.text(),
          }))
          .catch(() => null),
      )
      if (result !== null) {
        expect(result.status).toBe(500)
        expect(JSON.parse(result.body)).toEqual({ error: expect.any(String) })
        expect(result.body).not.toContain('response-write-secret')
      }
      if (admitted) expect(harness.application.execute).toHaveBeenCalledOnce()
      else expectNoAdmission(harness)
      expect(diagnostics).toHaveBeenCalled()
      expect(inspect(diagnostics.mock.calls)).not.toContain('response-write-secret')
      await expectRecovery(harness)
      expect(harness.application.query).toHaveBeenCalledOnce()
      expect(harness.application.execute).toHaveBeenCalledTimes(admitted ? 1 : 0)
    },
  )

  it('contains peer loss after command admission while the application is still completing', async () => {
    const application = applicationHarness()
    let acknowledgeAdmission: (() => void) | undefined
    const admitted = new Promise<void>((resolve) => {
      acknowledgeAdmission = resolve
    })
    let complete: ((outcome: CommandOutcome) => void) | undefined
    application.execute.mockImplementationOnce(() => {
      acknowledgeAdmission?.()
      return new Promise<CommandOutcome>((resolve) => {
        complete = resolve
      })
    })
    const harness = await transportHarness(application)
    const upload = pendingPost(`${harness.httpUrl}/api/command`)
    const disconnected = upload.response.catch(() => null)
    upload.request.end(JSON.stringify(VALID_COMMAND))
    await bounded(admitted)
    upload.request.destroy()
    await bounded(upload.closed)
    expect(await bounded(disconnected)).toBeNull()
    if (complete === undefined) throw new Error('application was not admitted')
    complete({
      ok: true,
      result: { type: 'configuration-updated', configurationVersion: 1 },
      state: state(1),
    })
    await expectRecovery(harness)
    expect(application.execute).toHaveBeenCalledOnce()
    expect(application.query).toHaveBeenCalledOnce()
  })

  it.each(['request', 'response'])(
    'contains a late %s error event after the response has flushed',
    async (target) => {
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      let acknowledgeError: (() => void) | undefined
      const emitted = new Promise<void>((resolve) => {
        acknowledgeError = resolve
      })
      let inject = true
      const harness = await transportHarness(
        applicationHarness(),
        undefined,
        (request, response) => {
          if (!inject) return
          inject = false
          response.once('finish', () => {
            queueMicrotask(() => {
              const emitter = target === 'request' ? request : response
              emitter.emit('error', new Error('late-event-secret'))
              acknowledgeError?.()
            })
          })
        },
      )
      const response = await bounded(post(`${harness.httpUrl}/api/command`, VALID_COMMAND))
      expect(response.status).toBe(200)
      expect(commandResultEnvelopeCodec.decode(await response.json()).ok).toBe(true)
      await bounded(emitted)
      expect(harness.application.execute).toHaveBeenCalledOnce()
      expect(diagnostics).toHaveBeenCalled()
      expect(inspect(diagnostics.mock.calls)).not.toContain('late-event-secret')
      await expectRecovery(harness)
    },
  )

  it.each(['query', 'command'])(
    'rejects a live %s body stream error before admission without leaking its cause',
    async (request) => {
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      let inject = true
      const harness = await transportHarness(applicationHarness(), undefined, (incoming) => {
        if (!inject) return
        inject = false
        queueMicrotask(() => incoming.emit('error', new Error('body-stream-secret')))
      })
      const upload = pendingPost(`${harness.httpUrl}/api/${request}`, { 'Content-Length': '1000' })
      upload.request.write('{"type":')
      const response = await bounded(upload.response)
      expect(response.status).toBe(400)
      expect(response.headers.connection).toBe('close')
      expect(JSON.parse(response.body)).toEqual({
        type: 'request-rejected',
        request,
        requestId: REQUEST_ID,
        reason: 'interrupted',
        message: expect.any(String),
      })
      expect(response.body).not.toContain('body-stream-secret')
      expect(inspect(diagnostics.mock.calls)).not.toContain('body-stream-secret')
      await bounded(upload.closed)
      expectNoAdmission(harness)
      await expectRecovery(harness)
    },
  )

  it.each([
    { request: 'query', serialization: 'malformed' },
    { request: 'command', serialization: 'malformed' },
    { request: 'query', serialization: 'throw' },
    { request: 'command', serialization: 'throw' },
  ])(
    'contains $request output whose serialization is $serialization after admission',
    async ({ request, serialization }) => {
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const application = applicationHarness()
      const queryReply: QueryResult = { ok: true, type: 'workspace-selection' }
      const commandReply: CommandOutcome = {
        ok: true,
        result: { type: 'configuration-updated', configurationVersion: 1 },
        state: state(1),
      }
      const reply = request === 'query' ? queryReply : commandReply
      Object.defineProperty(reply, 'toJSON', {
        value: () => {
          if (serialization === 'throw') throw new Error('serialize-only-secret')
          return { ...reply, token: 'serialize-only-secret' }
        },
      })
      if (request === 'query') application.query.mockResolvedValueOnce(queryReply)
      else application.execute.mockResolvedValueOnce(commandReply)
      const harness = await transportHarness(application)
      const response = await bounded(
        post(
          `${harness.httpUrl}/api/${request}`,
          request === 'query' ? VALID_QUERY : VALID_COMMAND,
        ),
      )
      const body = await response.text()
      expect(response.status).toBe(500)
      expect(JSON.parse(body)).toEqual({ error: expect.any(String) })
      expect(body).not.toContain('serialize-only-secret')
      expect(diagnostics).toHaveBeenCalled()
      expect(inspect(diagnostics.mock.calls)).not.toContain('serialize-only-secret')
      const operation = request === 'query' ? application.query : application.execute
      expect(operation).toHaveBeenCalledOnce()
      await expectRecovery(harness)
    },
  )
})
