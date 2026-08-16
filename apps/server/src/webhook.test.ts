import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySignature } from './webhook.ts'

const SECRET = "It's a Secret to Everybody"
const BODY = Buffer.from('Hello, World!')

function sign(secret: string, body: Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

describe('verifySignature', () => {
  it('verifies a genuine signature', () => {
    // The vector from GitHub's own validating-webhook-deliveries doc.
    expect(sign(SECRET, BODY)).toBe(
      'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    )
    expect(verifySignature(SECRET, BODY, sign(SECRET, BODY))).toBe('verified')
  })

  it('flags a wrong secret as a mismatch, not a crash', () => {
    expect(verifySignature('wrong', BODY, sign(SECRET, BODY))).toBe('mismatch')
  })

  it('flags a tampered body', () => {
    expect(verifySignature(SECRET, Buffer.from('Hello, World?'), sign(SECRET, BODY))).toBe(
      'mismatch',
    )
  })

  it('treats a missing or malformed header as unsigned', () => {
    expect(verifySignature(SECRET, BODY, undefined)).toBe('unsigned')
    expect(verifySignature(SECRET, BODY, 'sha1=abc')).toBe('unsigned')
  })

  it('reports no-secret so the caller can log the degraded mode once', () => {
    expect(verifySignature(null, BODY, sign(SECRET, BODY))).toBe('no-secret')
  })

  it('survives a signature that is not even hex of the right length', () => {
    expect(verifySignature(SECRET, BODY, 'sha256=zz')).toBe('mismatch')
  })
})
