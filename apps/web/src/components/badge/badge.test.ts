import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge.tsx'

describe('Badge', () => {
  it('renders the neutral variant by default', () => {
    expect(renderToStaticMarkup(Badge({ children: 'Unknown' }))).toBe(
      '<span class="badge badge-neutral">Unknown</span>',
    )
  })

  it('renders caller-provided React content for a semantic variant', () => {
    const children = createElement('strong', null, 'Needs review')

    expect(renderToStaticMarkup(Badge({ variant: 'danger', children }))).toBe(
      '<span class="badge badge-danger"><strong>Needs review</strong></span>',
    )
  })
})
