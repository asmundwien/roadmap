import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketMark, type TicketMarkSize } from './ticket-mark'

const TICKET = {
  state: 'claimed',
  type: 'prototype',
} as const

describe('TicketMark', () => {
  it.each([
    ['large', '32'],
    ['medium', '12'],
    ['small', '0.625em'],
  ] as const)('renders the %s size as a complete decorative SVG', (size, dimension) => {
    const markup = renderTicketMark(size)

    expect(markup.startsWith('<svg')).toBe(true)
    expect(markup).toContain(`class="ticket-mark ticket-mark-${size} state-claimed type-prototype"`)
    expect(markup).toContain(`width="${dimension}"`)
    expect(markup).toContain(`height="${dimension}"`)
    expect(markup).toContain('aria-hidden="true"')
  })

  it.each(['large', 'medium', 'small'] as const)(
    'preserves ticket state and type information at the %s size',
    (size) => {
      const markup = renderTicketMark(size)

      expect(markup).toContain('class="ticket-mark-half"')
      expect(markup).toContain('class="ticket-mark-content"')
      expect(markup).toContain('>P</text>')
      expect(markup.match(/class="ticket-mark-corner"/g)).toHaveLength(2)
    },
  )
})

function renderTicketMark(size: TicketMarkSize): string {
  return renderToStaticMarkup(
    createElement(TicketMark, {
      ...TICKET,
      size,
    }),
  )
}
