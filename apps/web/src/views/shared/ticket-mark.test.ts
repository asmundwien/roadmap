import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketMark } from './ticket-mark'

describe('TicketMark', () => {
  it('encodes state as color and fill, and type as glyph and corners', () => {
    const markup = renderToStaticMarkup(
      createElement(TicketMark, { size: 'large', state: 'claimed', type: 'prototype' }),
    )

    expect(markup).toContain('fill-half')
    expect(markup).toContain('variant-info')
    expect(markup).toContain('accent-warning')
    expect(markup).toContain('>P</text>')
    expect(markup.match(/class="mark-corner"/g)).toHaveLength(2)
  })

  it('replaces the glyph of a decided ticket while keeping its type corners', () => {
    const markup = renderToStaticMarkup(
      createElement(TicketMark, { size: 'small', state: 'closed', type: 'task' }),
    )

    expect(markup).toContain('>✓</text>')
    expect(markup.match(/class="mark-corner"/g)).toHaveLength(4)
  })
})
