import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Link } from './link'

describe('Link', () => {
  it('defaults to same-tab navigation with a right arrow', () => {
    const markup = renderToStaticMarkup(createElement(Link, { href: '#/components' }, 'Components'))

    expect(markup).toContain('href="#/components"')
    expect(markup).not.toContain('target="_blank"')
    expect(markup).toContain('<path d="M2.5 8h10m-4-4 4 4-4 4"')
  })

  it('opens external destinations in a new tab with an up-right arrow', () => {
    const markup = renderToStaticMarkup(
      createElement(Link, { href: 'https://github.com/settings', external: true }, 'Open GitHub'),
    )

    expect(markup).toContain('href="https://github.com/settings"')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('<path d="M4 12 12 4M5 4h7v7"')
    expect(markup).not.toContain('external=')
  })
})
