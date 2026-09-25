import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge, badgeForTicketState } from './badge.tsx'

describe('Badge', () => {
  it.each([
    ['blocked', 'blocked', 'Blocked'],
    ['frontier', 'takeable', 'Takeable'],
    ['claimed', 'claimed', 'Claimed'],
    ['closed', 'decided', 'Decided'],
  ] as const)('renders the canonical badge for %s tickets', (state, expectedVariant, label) => {
    const variant = badgeForTicketState(state)

    expect(variant).toBe(expectedVariant)
    expect(renderToStaticMarkup(createElement(Badge, { variant }))).toContain(`>${label}</span>`)
  })

  it('renders the golden integration variant', () => {
    expect(renderToStaticMarkup(Badge({ variant: 'local', children: 'Local' }))).toContain(
      'class="badge badge-local"',
    )
  })
})
