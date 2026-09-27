import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Link } from './link'

describe('Link', () => {
  it('renders a navigable anchor with external navigation attributes', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Link,
        { href: 'https://github.com/settings', target: '_blank', rel: 'noreferrer' },
        'Open GitHub',
      ),
    )
    expect(markup).toContain('href="https://github.com/settings"')
    expect(markup).toContain('target="_blank" rel="noreferrer"')
    expect(markup).toContain('Open GitHub</a>')
  })
})
