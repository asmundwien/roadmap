import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatusTag, statusTagForTicketState } from './status-tag.tsx'

describe('StatusTag', () => {
  it.each([
    ['blocked', 'Blocked'],
    ['frontier', 'Takeable'],
    ['claimed', 'Claimed'],
    ['closed', 'Decided'],
  ] as const)('maps %s ticket state to its canonical tag', (state, label) => {
    const variant = statusTagForTicketState(state)
    expect(renderToStaticMarkup(createElement(StatusTag, { variant }))).toContain(
      `>${label}</span>`,
    )
  })
})
