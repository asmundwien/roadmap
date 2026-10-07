import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Link } from './link'

describe('Link', () => {
  it('defaults to same-tab navigation with a right arrow', () => {
    const markup = renderToStaticMarkup(createElement(Link, { href: '/components' }, 'Components'))

    expect(markup).toContain('href="/components"')
    expect(markup).not.toContain('target="_blank"')
    expect(markup).toContain('Internal%20link')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('<svg')
  })

  it('opens external destinations in a new tab with an up-right arrow', () => {
    const markup = renderToStaticMarkup(
      createElement(Link, { href: 'https://github.com/settings', external: true }, 'Open GitHub'),
    )

    expect(markup).toContain('href="https://github.com/settings"')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('External%20link')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('<svg')
    expect(markup).not.toContain('external=')
  })
})
