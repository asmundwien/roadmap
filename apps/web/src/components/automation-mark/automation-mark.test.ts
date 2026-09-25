import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AutomationMark } from './automation-mark.tsx'

describe('AutomationMark', () => {
  it('renders a stage-specific plot mark and glyph at the requested coordinates', () => {
    const markup = renderToStaticMarkup(
      createElement(AutomationMark, {
        variant: 'plot',
        stage: 'classification',
        glyph: 'C',
        x: 12,
        y: 18,
      }),
    )

    expect(markup).toContain('class="automation-mark stage-classification"')
    expect(markup).toContain('x="12"')
    expect(markup).toContain('>C</text>')
  })

  it('wraps a stage mark for inline text without exposing decorative SVG', () => {
    const markup = renderToStaticMarkup(
      createElement(AutomationMark, { variant: 'inline', stage: 'wayfinder' }),
    )

    expect(markup).toContain('class="automation-mark-inline"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('class="automation-mark stage-wayfinder"')
  })
})
