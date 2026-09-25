import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge.tsx'

describe('Badge', () => {
  it('renders semantic color variants', () => {
    expect(renderToStaticMarkup(Badge({ variant: 'github', children: 'GitHub' }))).toContain(
      'class="badge badge-github"',
    )
  })
})
