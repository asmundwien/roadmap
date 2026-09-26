import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DestinationMark } from './destination-mark'

describe('DestinationMark', () => {
  it('renders the destination signal at plot coordinates', () => {
    const markup = renderToStaticMarkup(
      createElement(DestinationMark, { variant: 'plot', x: 12, y: 18 }),
    )

    expect(markup).toContain('class="destination-mark"')
    expect(markup).toContain('class="destination-halo" cx="12" cy="18"')
    expect(markup).toContain('class="destination-glyph" x="12" y="25"')
  })

  it('wraps the plot mark for headers without exposing decorative SVG', () => {
    const markup = renderToStaticMarkup(createElement(DestinationMark, { variant: 'header' }))

    expect(markup).toContain('class="destination-mark-header"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('class="destination-mark"')
  })
})
