import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { ApplicationState } from '@roadmap/contracts'
import {
  type CommandResultEnvelope,
  commandResultEnvelopeCodec,
  type QueryResultEnvelope,
  queryResultEnvelopeCodec,
  type StateEnvelope,
  stateEnvelopeCodec,
} from '@roadmap/contracts/codecs'
import {
  decodeCommandEnvelope,
  decodeQueryEnvelope,
  REQUEST_ID_HEADER,
  type RequestRejection,
  requestIdSchema,
  requestRejectionStatus,
} from '@roadmap/contracts/wire'
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

  const broadcast = (state: ApplicationState): void => {
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
    void handleApiRequest(request, response, path, options, maxBodyBytes).catch(() => {
      reportTransportFailure('request task')
      terminateResponse(response)
    })
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
  const lifetime = new ApiRequestLifetime(request, response)
  const requestKind = path === QUERY_PATH ? 'query' : 'command'
  let requestId: string | null = null

  const reject = async (reason: RequestRejection['reason'], message: string): Promise<void> => {
    const rejection: RequestRejection = {
      type: 'request-rejected',
      request: requestKind,
      requestId,
      reason,
      message,
    }
    await lifetime.sendJson(
      requestRejectionStatus(reason),
      rejection,
      reason !== 'malformed-json' && reason !== 'malformed-envelope',
    )
  }

  async function acceptHeaders(): Promise<boolean> {
    if (request.headers.origin !== options.allowedOrigin) {
      await reject('origin', 'Origin is not allowed.')
      return false
    }
    setCors(response, options.allowedOrigin)
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'POST')
      response.setHeader('Access-Control-Allow-Headers', `Content-Type, ${REQUEST_ID_HEADER}`)
      response.setHeader('Access-Control-Max-Age', '600')
      await lifetime.sendJson(204, undefined, !request.complete)
      return false
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS')
      await reject('method', 'Method must be POST.')
      return false
    }
    if (requestKind === 'command' && !isLoopback(request.socket.remoteAddress)) {
      await reject('peer', 'Command peer is not allowed.')
      return false
    }
    if (
      request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      await reject('media-type', 'Content-Type must be application/json.')
      return false
    }
    return true
  }

  async function dispatchParsedOperation(input: unknown): Promise<void> {
    if (requestKind === 'query') {
      const decoded = decodeQueryEnvelope(input)
      if (!decoded.ok) {
        await reject('malformed-envelope', 'Malformed query request.')
        return
      }
      if (!lifetime.admit()) return
      const result = await options.application.query(decoded.value.query)
      const envelope: QueryResultEnvelope = { type: 'query-result', result }
      await lifetime.sendJson(200, envelope, false, queryResultEnvelopeCodec.decode)
    } else {
      const decoded = decodeCommandEnvelope(input)
      if (!decoded.ok) {
        await reject('malformed-envelope', 'Malformed command request.')
        return
      }
      if (!lifetime.admit()) return
      const outcome = await options.application.execute(decoded.value.command)
      const envelope: CommandResultEnvelope = { type: 'command-result', outcome }
      await lifetime.sendJson(200, envelope, false, commandResultEnvelopeCodec.decode)
    }
  }

  async function containFailure(): Promise<void> {
    reportTransportFailure('request processing')
    try {
      if (!lifetime.canRespond || response.headersSent) {
        lifetime.terminate()
        return
      }
      await lifetime.sendJson(500, { error: 'Internal transport error.' }, true)
    } catch {
      lifetime.terminate()
    }
  }

  try {
    const correlation = requestIdSchema.safeParse(request.headers[REQUEST_ID_HEADER.toLowerCase()])
    if (correlation.success) requestId = correlation.data

    if (!(await acceptHeaders())) return

    const body = await lifetime.readBody(maxBodyBytes)
    if (!body.ok) {
      await reject(
        body.reason,
        body.reason === 'too-large'
          ? 'Request body is too large.'
          : 'Request body was interrupted.',
      )
      return
    }

    let input: unknown
    try {
      input = JSON.parse(body.text)
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error
      await reject('malformed-json', 'Request body must contain valid JSON.')
      return
    }
    if (lifetime.interrupted) {
      await reject('interrupted', 'Request body was interrupted.')
      return
    }

    await dispatchParsedOperation(input)
  } catch {
    await containFailure()
  }
}

function encodeState(state: ApplicationState): string | null {
  const envelope: StateEnvelope = { type: 'state', state }
  try {
    return encodeOutgoing(envelope, stateEnvelopeCodec.decode)
  } catch {
    reportTransportFailure('application state encoding')
    return null
  }
}

type EnvelopeDecoder = (input: unknown) => { ok: boolean }

function encodeOutgoing(value: unknown, decode: EnvelopeDecoder): string {
  if (!decode(value).ok) throw new Error('Invalid application envelope.')
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Application envelope did not serialize.')
  // toJSON and getters can change a value after the first decode.
  const serialized: unknown = JSON.parse(encoded)
  if (!decode(serialized).ok) throw new Error('Invalid serialized application envelope.')
  return encoded
}

function reportTransportFailure(kind: string): void {
  try {
    console.error(`Roadmap transport failure: ${kind}.`)
  } catch {
    // Diagnostic failures must not escape the request's containment.
  }
}

function setCors(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
}

function terminateResponse(response: ServerResponse): void {
  try {
    response.destroy()
  } catch {
    // Still try to terminate the socket when response teardown itself fails.
  }
  try {
    response.socket?.destroy()
  } catch {
    // There is no further response recovery after the connection is lost.
  }
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

type BodyResult = { ok: true; text: string } | { ok: false; reason: 'too-large' | 'interrupted' }

/** Owns stream events until completion and keeps late error events contained. */
class ApiRequestLifetime {
  interrupted = false
  private admitted = false
  private responseClosed = false
  private responseFailed = false
  private responseFinished = false
  private settleBody: ((result: BodyResult) => void) | undefined
  private settleWrite: ((finished: boolean) => void) | undefined
  private readonly request: IncomingMessage
  private readonly response: ServerResponse

  constructor(request: IncomingMessage, response: ServerResponse) {
    this.request = request
    this.response = response
    request.on('error', () => {
      reportTransportFailure('request stream')
      this.interruptBody()
      if (this.admitted && !this.responseFinished) this.terminate()
    })
    request.once('aborted', () => this.interruptBody())
    request.once('close', () => {
      if (!request.complete) this.interruptBody()
    })
    response.on('error', () => {
      reportTransportFailure('response stream')
      this.responseFailed = true
      this.interruptBody()
      this.settleWrite?.(false)
      if (!this.responseFinished) this.terminate()
    })
    response.once('finish', () => {
      this.responseFinished = true
      this.settleWrite?.(true)
      this.settleWrite = undefined
    })
    response.once('close', () => {
      this.responseClosed = true
      if (!this.responseFinished) {
        if (this.admitted) reportTransportFailure('peer close after admission')
        this.interruptBody()
        this.settleWrite?.(false)
        this.settleWrite = undefined
      }
    })
  }

  get canRespond(): boolean {
    return (
      !this.responseClosed &&
      !this.responseFailed &&
      !this.response.destroyed &&
      !this.request.socket.destroyed &&
      !this.response.writableEnded
    )
  }

  admit(): boolean {
    if (this.interrupted || !this.canRespond) return false
    this.admitted = true
    return true
  }

  private interruptBody(): void {
    this.interrupted = true
    this.settleBody?.({ ok: false, reason: 'interrupted' })
  }

  private stopInput(): void {
    this.request.pause()
    this.request.socket.pause()
  }

  terminate(): void {
    terminateResponse(this.response)
  }

  async readBody(maxBytes: number): Promise<BodyResult> {
    const declared = Number(this.request.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      this.stopInput()
      return { ok: false, reason: 'too-large' }
    }
    if (this.interrupted || this.request.destroyed || !this.canRespond) {
      return { ok: false, reason: 'interrupted' }
    }

    return new Promise<BodyResult>((resolve, reject) => {
      const chunks: Buffer[] = []
      let bytes = 0
      const cleanup = (): void => {
        this.request.off('data', onData)
        this.request.off('end', onEnd)
        this.settleBody = undefined
      }
      const finish = (result: BodyResult): void => {
        cleanup()
        chunks.length = 0
        resolve(result)
      }
      const onData = (chunk: Buffer): void => {
        try {
          if (chunk.byteLength > maxBytes - bytes) {
            this.stopInput()
            finish({ ok: false, reason: 'too-large' })
            return
          }
          bytes += chunk.byteLength
          chunks.push(chunk)
        } catch {
          cleanup()
          chunks.length = 0
          reject(new Error('Request body read failed.'))
        }
      }
      const onEnd = (): void => {
        try {
          const first = chunks[0]
          const buffer =
            chunks.length === 1 && first !== undefined ? first : Buffer.concat(chunks, bytes)
          finish({ ok: true, text: buffer.toString('utf8') })
        } catch {
          cleanup()
          chunks.length = 0
          reject(new Error('Request body encoding failed.'))
        }
      }
      this.settleBody = finish
      this.request.on('data', onData)
      this.request.once('end', onEnd)
    })
  }

  async sendJson(
    status: number,
    value: unknown,
    closeInput = false,
    decode?: EnvelopeDecoder,
  ): Promise<void> {
    const encoded =
      value === undefined
        ? undefined
        : decode === undefined
          ? JSON.stringify(value)
          : encodeOutgoing(value, decode)
    if (!this.canRespond) return
    if (closeInput) this.stopInput()

    const finished = await new Promise<boolean>((resolve, reject) => {
      this.settleWrite = resolve
      try {
        this.response.writeHead(status, {
          ...(encoded === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
          ...(closeInput ? { Connection: 'close' } : {}),
        })
        this.response.end(encoded)
      } catch {
        this.settleWrite = undefined
        reject(new Error('Response write failed.'))
      }
    })
    if (!finished) throw new Error('Response did not finish.')
    if (closeInput) this.request.socket.destroySoon()
  }
}
