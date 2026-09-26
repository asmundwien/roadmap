import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketMark } from './ticket-mark'

// Mark scopes its class names to its own CSS Module, so this test reads the drawing instead:
// the glyph, and the path count, which is the face plus the half fill plus one per corner.
const FACE_AND_HALF_PATHS = 2
const FACE_PATH = 1

describe('TicketMark', () => {
  it('encodes a claimed prototype as a half fill with two type corners', () => {
    const markup = renderToStaticMarkup(
      createElement(TicketMark, { size: 'large', state: 'claimed', type: 'prototype' }),
    )

    expect(markup).toContain('>P</text>')
    expect(pathCount(markup) - FACE_AND_HALF_PATHS).toBe(2)
  })

  it('replaces the glyph of a decided ticket while keeping its type corners', () => {
    const markup = renderToStaticMarkup(
      createElement(TicketMark, { size: 'small', state: 'closed', type: 'task' }),
    )

    expect(markup).toContain('>✓</text>')
    expect(pathCount(markup) - FACE_PATH).toBe(4)
  })
})

function pathCount(markup: string): number {
  return markup.match(/<path\b/g)?.length ?? 0
}
