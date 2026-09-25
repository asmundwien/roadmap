import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketMark } from './ticket-mark.tsx'

describe('TicketMark', () => {
  const presentation = {
    accent: 'warning',
    children: 'P',
    cornerCount: 2,
    fill: 'half',
    variant: 'success',
  } as const

  it('renders independent color, accent, fill, corners, and content', () => {
    const markup = renderToStaticMarkup(
      TicketMark({ ...presentation, size: 'major', x: 10, y: 20 }),
    )

    expect(markup).toContain('class="ticket-mark fill-half"')
    expect(markup).toContain('color="var(--variant-success)"')
    expect(markup).toContain('color="var(--variant-warning)"')
    expect(markup.match(/class="mark-corner"/g)).toHaveLength(2)
    expect(markup).toContain('class="mark-half"')
    expect(markup).toContain('class="mark-content" color="var(--variant-success)"')
  })

  it('renders the minor size at plot coordinates without content', () => {
    const markup = renderToStaticMarkup(
      TicketMark({ ...presentation, size: 'minor', x: 10, y: 20 }),
    )

    expect(markup).toContain('class="node-shape node-mark is-minor"')
    expect(markup).not.toContain('<svg')
    expect(markup).not.toContain('<text')
  })

  it('wraps the tiny size for inline text without exposing decorative SVG', () => {
    const markup = renderToStaticMarkup(TicketMark({ ...presentation, size: 'tiny' }))

    expect(markup).toContain('class="ticket-mark-tiny"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('class="node-shape node-mark is-tiny"')
    expect(markup).not.toContain('<text')
  })

  it('renders only the first character of content', () => {
    const markup = renderToStaticMarkup(
      TicketMark({ ...presentation, children: 'AB', size: 'major', x: 0, y: 0 }),
    )

    expect(markup).toContain('>A</text>')
    expect(markup).not.toContain('>AB</text>')
  })
})
