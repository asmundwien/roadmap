import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { CommandOutcome, QueryResult } from '@roadmap/contracts'
import {
  type CommandResultEnvelope,
  commandEnvelopeCodec,
  commandResultEnvelopeCodec,
  type QueryResultEnvelope,
  queryEnvelopeCodec,
  queryResultEnvelopeCodec,
  type StateEnvelope,
  stateEnvelopeCodec,
} from '@roadmap/contracts/codecs'
import { WebSocket, WebSocketServer } from 'ws'
import type { RoadmapApplication } from './application/application.ts'

const DEFAULT_MAX_BODY_BYTES = 64 * 1024
const QUERY_PATH = '/api/query'
const COMMAND_PATH = '/api/command'
const SOCKET_PATH = '/ws'

export interface RoadmapTransport {
  handle(request: IncomingMessage, response: ServerResponse): boolean
  clientCount(): number
  close(): void
}

export interface RoadmapTransportOptions {
  server: Server
  application: RoadmapApplication
  allowedOrigin: string
  maxBodyBytes?: number
}

/**
 * The application's one network transport Module. WebSocket carries authoritative state only;
 * bounded HTTP requests carry queries and commands. Every browser-facing entry point enforces the
 * same exact Origin and commands additionally require a loopback peer.
 */
export function createRoadmapTransport(options: RoadmapTransportOptions): RoadmapTransport {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const sockets = new WebSocketServer({ noServer: true })

  const broadcast = (state: ReturnType<RoadmapApplication['current']>): void => {
    const encoded = encodeState(state)
    if (encoded === null) return
    for (const client of sockets.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(encoded)
    }
  }
  const unsubscribe = options.application.subscribe(broadcast)

  sockets.on('connection', (client) => {
    const encoded = encodeState(options.application.current())
    if (encoded !== null) client.send(encoded)
  })

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (request.url !== SOCKET_PATH) {
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }
    if (request.headers.origin !== options.allowedOrigin) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      sockets.emit('connection', client, request)
    })
  }
  options.server.on('upgrade', upgrade)

  function handle(request: IncomingMessage, response: ServerResponse): boolean {
    const path = request.url?.split('?', 1)[0]
    if (path !== QUERY_PATH && path !== COMMAND_PATH) return false
    void handleApiRequest(request, response, path, options, maxBodyBytes)
    return true
  }

  return {
    handle,
    clientCount: () => sockets.clients.size,
    close() {
      unsubscribe()
      options.server.off('upgrade', upgrade)
      for (const client of sockets.clients) client.terminate()
      sockets.close()
    },
  }
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: typeof QUERY_PATH | typeof COMMAND_PATH,
  options: RoadmapTransportOptions,
  maxBodyBytes: number,
): Promise<void> {
  if (!acceptApiRequest(request, response, path, options.allowedOrigin)) return
  const body = await readJson(request, maxBodyBytes)
  if (!body.ok) {
    sendBodyFailure(response, path, options.application, body)
    return
  }
  if (path === QUERY_PATH) await handleQuery(response, options.application, body.value)
  else await handleCommand(response, options.application, body.value)
}

function acceptApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: typeof QUERY_PATH | typeof COMMAND_PATH,
  allowedOrigin: string,
): boolean {
  if (request.headers.origin !== allowedOrigin) {
    sendPlainError(response, 403, 'Forbidden')
    return false
  }
  setCors(response, allowedOrigin)
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    })
    response.end()
    return false
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS')
    sendPlainError(response, 405, 'Method Not Allowed')
    return false
  }
  if (path === COMMAND_PATH && !isLoopback(request.socket.remoteAddress)) {
    sendPlainError(response, 403, 'Forbidden')
    return false
  }
  if (
    request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    sendPlainError(response, 415, 'Content-Type must be application/json')
    return false
  }
  return true
}

function sendBodyFailure(
  response: ServerResponse,
  path: typeof QUERY_PATH | typeof COMMAND_PATH,
  application: RoadmapApplication,
  body: Extract<BodyResult, { ok: false }>,
): void {
  if (path === QUERY_PATH) sendQueryResult(response, body.status, failedQuery(body.message))
  else sendCommandOutcome(response, body.status, failedCommand(application, body.message))
}

async function handleQuery(
  response: ServerResponse,
  application: RoadmapApplication,
  input: unknown,
): Promise<void> {
  const decoded = queryEnvelopeCodec.decode(input)
  if (!decoded.ok) {
    sendQueryResult(response, 400, failedQuery('Malformed query request.'))
    return
  }
  try {
    sendQueryResult(response, 200, await application.query(decoded.value.query))
  } catch {
    sendPlainError(response, 500, 'Internal transport error.')
  }
}

async function handleCommand(
  response: ServerResponse,
  application: RoadmapApplication,
  input: unknown,
): Promise<void> {
  const decoded = commandEnvelopeCodec.decode(input)
  if (!decoded.ok) {
    sendCommandOutcome(response, 400, failedCommand(application, 'Malformed command request.'))
    return
  }
  try {
    sendCommandOutcome(response, 200, await application.execute(decoded.value.command))
  } catch {
    sendPlainError(response, 500, 'Internal transport error.')
  }
}

function failedQuery(message: string): QueryResult {
  return { ok: false, error: { code: 'validation', message } }
}

function failedCommand(application: RoadmapApplication, message: string): CommandOutcome {
  return {
    ok: false,
    error: { code: 'validation', message },
    state: application.current(),
  }
}

function sendQueryResult(response: ServerResponse, status: number, result: QueryResult): void {
  const envelope: QueryResultEnvelope = { type: 'query-result', result }
  const decoded = queryResultEnvelopeCodec.decode(envelope)
  if (!decoded.ok) {
    reportCodecFailure('query result', decoded.issues)
    sendPlainError(response, 500, 'Internal transport error.')
    return
  }
  sendJson(response, status, decoded.value)
}

function sendCommandOutcome(
  response: ServerResponse,
  status: number,
  outcome: CommandOutcome,
): void {
  const envelope: CommandResultEnvelope = { type: 'command-result', outcome }
  const decoded = commandResultEnvelopeCodec.decode(envelope)
  if (!decoded.ok) {
    reportCodecFailure('command result', decoded.issues)
    sendPlainError(response, 500, 'Internal transport error.')
    return
  }
  sendJson(response, status, decoded.value)
}

function encodeState(state: ReturnType<RoadmapApplication['current']>): string | null {
  const envelope: StateEnvelope = { type: 'state', state }
  const decoded = stateEnvelopeCodec.decode(envelope)
  if (!decoded.ok) {
    reportCodecFailure('application state', decoded.issues)
    return null
  }
  return JSON.stringify(decoded.value)
}

function reportCodecFailure(
  kind: string,
  issues: readonly { path: string; message: string }[],
): void {
  console.error(
    `Refused malformed ${kind}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
  )
}

function setCors(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function sendPlainError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message })
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
}

function isLoopback(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address?.startsWith('127.') === true
  )
}

type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413; message: string }

async function readJson(request: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    request.resume()
    return { ok: false, status: 413, message: 'Request body is too large.' }
  }

  const chunks: Buffer[] = []
  let bytes = 0
  let oversized = false
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > maxBytes) {
      oversized = true
      continue
    }
    chunks.push(buffer)
  }
  if (oversized) return { ok: false, status: 413, message: 'Request body is too large.' }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  } catch {
    return { ok: false, status: 400, message: 'Request body must contain valid JSON.' }
  }
}
