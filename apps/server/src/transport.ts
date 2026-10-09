import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  type CommandResultEnvelope,
  decodeCommandEnvelope,
  decodeCommandResultEnvelope,
  decodeQueryEnvelope,
  decodeQueryResultEnvelope,
  decodeStateEnvelope,
  type QueryResultEnvelope,
  REQUEST_ID_HEADER,
  type RequestRejection,
  requestIdSchema,
  requestRejectionStatus,
  type StateEnvelope,
} from '@roadmap/contracts/wire'
import { WebSocket, WebSocketServer } from 'ws'
import type { RoadmapApplication } from './application/application.ts'

const DEFAULT_MAX_BODY_BYTES = 64 * 1024
const QUERY_PATH = '/api/query'
const COMMAND_PATH = '/api/command'
const SOCKET_PATH = '/ws'
const HEALTH_PATH = '/health'
const READY_PATH = '/ready'

export interface RoadmapTransport {
  handle(request: IncomingMessage, response: ServerResponse): boolean
  clientCount(): number
  close(): Promise<void>
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
  const requests = new Map<ApiRequestLifetime, Promise<void>>()
  let closing: Promise<void> | undefined

  const broadcast = (state: ReturnType<RoadmapApplication['current']>): void => {
    if (closing || options.application.diagnostics().lifecycle.phase !== 'ready') return
    const encoded = encodeState(state)
    if (encoded === null) return
    for (const client of sockets.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(encoded)
    }
  }
  const unsubscribe = options.application.subscribe(broadcast)

  sockets.on('connection', (client) => {
    client.on('error', () => reportTransportFailure('WebSocket stream'))
    if (closing || options.application.diagnostics().lifecycle.phase !== 'ready') return
    const encoded = encodeState(options.application.current())
    if (encoded !== null) client.send(encoded)
  })

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (closing) {
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return
    }
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
    if (path !== QUERY_PATH && path !== COMMAND_PATH && path !== HEALTH_PATH && path !== READY_PATH)
      return false
    if (closing) {
      terminateResponse(response)
      return true
    }
    const lifetime = new ApiRequestLifetime(request, response)
    const task = Promise.resolve().then(async () => {
      try {
        if (path === HEALTH_PATH || path === READY_PATH) {
          if (request.method !== 'GET') {
            response.setHeader('Allow', 'GET')
            await lifetime.sendJson(405, { error: 'Method must be GET.' }, !request.complete)
            return
          }
          const diagnostics = options.application.diagnostics()
          const lifecycle =
            diagnostics.lifecycle.phase === 'ready'
              ? { phase: diagnostics.lifecycle.phase, mode: diagnostics.lifecycle.mode }
              : diagnostics.lifecycle.phase === 'failed'
                ? { phase: diagnostics.lifecycle.phase, cause: 'Application startup failed.' }
                : { phase: diagnostics.lifecycle.phase }
          await lifetime.sendJson(
            path === READY_PATH && lifecycle.phase !== 'ready' ? 503 : 200,
            {
              lifecycle,
              projects: diagnostics.projects,
              maps: diagnostics.maps,
              unavailable: diagnostics.unavailable,
              absent: diagnostics.absent,
              clients: sockets.clients.size,
            },
            !request.complete,
          )
        } else {
          await handleApiRequest(request, response, path, options, maxBodyBytes, lifetime)
        }
      } catch {
        reportTransportFailure('request task')
        lifetime.terminate()
      } finally {
        requests.delete(lifetime)
      }
    })
    requests.set(lifetime, task)
    return true
  }

  return {
    handle,
    clientCount: () => sockets.clients.size,
    close() {
      if (closing) return closing
      const errors: unknown[] = []
      closing = Promise.resolve().then(async () => {
        try {
          unsubscribe()
        } catch (error: unknown) {
          errors.push(error)
        }
        try {
          options.server.off('upgrade', upgrade)
        } catch (error: unknown) {
          errors.push(error)
        }
        const socketClosure = new Promise<void>((resolve, reject) => {
          sockets.close((error) => (error ? reject(error) : resolve()))
        })
        // Observe closure failure while admitted HTTP effects still drain.
        const socketResult = socketClosure.then(
          () => undefined,
          (error: unknown) => {
            errors.push(error)
          },
        )
        for (const client of sockets.clients) {
          try {
            client.terminate()
          } catch (error: unknown) {
            errors.push(error)
          }
        }
        await Promise.all([...requests.values(), socketResult])
        // server.close() only reaps sockets that were idle when it was called.
        // Replies whose headers were already sent can become idle after the drain.
        try {
          options.server.closeIdleConnections()
        } catch (error: unknown) {
          errors.push(error)
        }
        if (errors.length > 0) throw new AggregateError(errors, 'Transport shutdown failed.')
      })
      // Close response connections after flush and revoke every body not yet admitted.
      for (const lifetime of requests.keys()) {
        try {
          lifetime.beginShutdown()
        } catch (error: unknown) {
          errors.push(error)
          lifetime.terminate()
        }
      }
      return closing
    },
  }
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: typeof QUERY_PATH | typeof COMMAND_PATH,
  options: RoadmapTransportOptions,
  maxBodyBytes: number,
  lifetime: ApiRequestLifetime,
): Promise<void> {
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
      await lifetime.sendJson(200, envelope, false, decodeQueryResultEnvelope)
    } else {
      const decoded = decodeCommandEnvelope(input)
      if (!decoded.ok) {
        await reject('malformed-envelope', 'Malformed command request.')
        return
      }
      if (!lifetime.admit()) return
      const outcome = await options.application.execute(decoded.value.command)
      const envelope: CommandResultEnvelope = { type: 'command-result', outcome }
      await lifetime.sendJson(200, envelope, false, (input) =>
        decodeCommandResultEnvelope(input, decoded.value.command),
      )
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

function encodeState(state: ReturnType<RoadmapApplication['current']>): string | null {
  const envelope: StateEnvelope = { type: 'state', state }
  try {
    return encodeOutgoing(envelope, decodeStateEnvelope)
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

  beginShutdown(): void {
    this.response.shouldKeepAlive = false
    if (this.admitted) return
    this.interruptBody()
    this.stopInput()
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
