import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MapRef } from '@roadmap/contracts'
import { classifyDelivery, type DeliveryPayload, type Invalidation } from './invalidation.ts'

/**
 * Verification is best-effort by design: smee re-serializes the body, so GitHub's signature
 * (computed over the original bytes) only matches when the parse→stringify round-trip is
 * byte-identical. A mismatch is therefore logged, never fatal — a forged delivery can only
 * trigger a rate-limited refetch through the already-authenticated client, never data ingestion.
 * See docs/research/webhook-path.md §3.
 */
export type SignatureResult = 'verified' | 'mismatch' | 'unsigned' | 'no-secret'

export function verifySignature(
  secret: string | null,
  body: Buffer,
  header: string | undefined,
): SignatureResult {
  if (secret === null) return 'no-secret'
  if (!header?.startsWith('sha256=')) return 'unsigned'
  const expected = createHmac('sha256', secret).update(body).digest()
  const received = Buffer.from(header.slice('sha256='.length), 'hex')
  if (received.length !== expected.length) return 'mismatch'
  return timingSafeEqual(expected, received) ? 'verified' : 'mismatch'
}

/** GitHub payloads can reach 25MB; anything past that is not a webhook we want. */
const MAX_BODY_BYTES = 25 * 1024 * 1024

/** How many `X-GitHub-Delivery` ids to remember for dedup (redeliveries reuse the id). */
const DEDUP_CAPACITY = 1000

export interface WebhookOptions {
  secret: string | null
  knownMaps: () => MapRef[]
  onInvalidation: (invalidation: Invalidation) => void
}

/**
 * The receiver behind POST /webhook: ACK fast (the refetch runs async off the store's queue),
 * classify the payload into an invalidation, and hand it over. Responses are 202 for everything
 * accepted — including ignores — because GitHub only wants a 2xx within 10 seconds.
 */
export function createWebhookHandler(options: WebhookOptions) {
  const seenDeliveries = new Set<string>()

  // The delivery pipeline, one check per step; the returned pair becomes the HTTP response.
  // Everything is a 2xx except a request we couldn't even read — GitHub wants its ACK within
  // 10 seconds, and the refetch itself runs async off the store's queue.
  function accept(request: IncomingMessage, body: Buffer): { status: number; message: string } {
    const event = headerValue(request, 'x-github-event')
    const delivery = headerValue(request, 'x-github-delivery')
    const signature = verifyAndWarn(request, body, options.secret)

    if (delivery && seenDeliveries.has(delivery)) return { status: 202, message: 'duplicate' }
    if (delivery) remember(seenDeliveries, delivery)
    if (!event) return { status: 400, message: 'missing x-github-event' }

    const payload = parsePayload(body)
    if (payload === null) return { status: 400, message: 'unparsable payload' }

    const invalidation = classifyDelivery(event, payload, options.knownMaps())
    console.info(
      `webhook ${event}.${payload.action ?? '?'} → ${describeInvalidation(invalidation)} [${signature}]`,
    )

    options.onInvalidation(invalidation)
    return { status: 202, message: 'accepted' }
  }

  return function handleWebhook(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = []
    let size = 0
    let overflow = false

    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        overflow = true
        request.destroy()
        return
      }
      chunks.push(chunk)
    })

    request.on('end', () => {
      if (overflow) return
      const { status, message } = accept(request, Buffer.concat(chunks))
      respond(response, status, message)
    })

    request.on('error', () => {
      respond(response, 400, 'read error')
    })
  }
}

function verifyAndWarn(
  request: IncomingMessage,
  body: Buffer,
  secret: string | null,
): SignatureResult {
  const signature = verifySignature(secret, body, headerValue(request, 'x-hub-signature-256'))
  if (signature === 'mismatch' || signature === 'unsigned') {
    const delivery = headerValue(request, 'x-github-delivery') ?? ''
    console.warn(`webhook delivery ${delivery}: signature ${signature} (smee re-serialization?)`)
  }
  return signature
}

function describeInvalidation(invalidation: Invalidation): string {
  return invalidation.kind === 'ignore' ? `ignore (${invalidation.reason})` : invalidation.kind
}

function parsePayload(body: Buffer): DeliveryPayload | null {
  try {
    return JSON.parse(body.toString('utf8')) as DeliveryPayload
  } catch {
    return null
  }
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const raw = request.headers[name]
  return Array.isArray(raw) ? raw[0] : raw
}

function respond(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent) return
  response.writeHead(status, { 'Content-Type': 'text/plain' })
  response.end(message)
}

function remember(seen: Set<string>, delivery: string): void {
  seen.add(delivery)
  if (seen.size > DEDUP_CAPACITY) {
    const oldest = seen.values().next().value
    if (oldest !== undefined) seen.delete(oldest)
  }
}
