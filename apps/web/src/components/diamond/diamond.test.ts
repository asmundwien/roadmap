import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Diamond } from './diamond.tsx'

describe('Diamond', () => {
  it('centers all four points around the requested coordinates', () => {
    const markup = renderToStaticMarkup(
      createElement(Diamond, { className: 'mark', x: 10, y: 20, radius: 4 }),
    )

    expect(markup).toBe('<path class="mark" d="M 10 16 L 14 20 L 10 24 L 6 20 Z"></path>')
  })
})
