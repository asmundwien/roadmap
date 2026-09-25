import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketMark } from './ticket-mark.tsx'

describe('TicketMark', () => {
  it('renders tracker and ticket-type evidence in a major mark', () => {
    const markup = renderToStaticMarkup(
      createElement(TicketMark, {
        state: 'frontier',
        type: 'prototype',
        variant: 'major',
        x: 10,
        y: 20,
      }),
    )

    expect(markup).toContain('class="ticket-mark type-prototype state-frontier"')
    expect(markup).toContain('class="frontier-field"')
    expect(markup).toContain('class="type-rune"')
    expect(markup).toContain('>P</text>')
  })

  it('wraps the minor mark for inline text without exposing decorative SVG', () => {
    const markup = renderToStaticMarkup(
      createElement(TicketMark, {
        state: 'closed',
        type: 'task',
        variant: 'inline',
      }),
    )

    expect(markup).toContain('class="ticket-mark-inline"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('class="ticket-mark type-task state-closed"')
    expect(markup).not.toContain('class="type-rune"')
  })
})
