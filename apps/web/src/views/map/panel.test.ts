import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Panel } from './panel'
import { makeMap, ticket } from './test-fixtures'

describe('Panel', () => {
  it('separates ticket state metadata in text output', () => {
    const selectedTicket = {
      ...ticket(10, 'frontier'),
      assignees: [{ name: 'Alice' }],
    }
    const markup = renderToStaticMarkup(
      createElement(Panel, {
        map: makeMap([selectedTicket]),
        item: { kind: 'ticket', id: selectedTicket.id },
        onClose: () => undefined,
        onStep: () => undefined,
        onSelect: () => undefined,
        hasPrev: false,
        hasNext: false,
        automation: {
          state: {
            enabled: false,
            enabledProjects: [],
            availability: { status: 'unavailable', cause: 'Disabled for test' },
            evidence: [],
            overrides: [],
          },
          configurationVersion: 1,
          commandInFlight: false,
          execute: async () => {
            throw new Error('not called')
          },
        },
      }),
    )

    expect(markup).toContain('Takeable</span> · <span>Alice</span>')
  })
  it('keeps panel navigation labelled while showing distinct direction and dismiss icons', () => {
    const markup = renderToStaticMarkup(
      createElement(Panel, {
        map: makeMap([]),
        item: { kind: 'map' },
        onClose: () => undefined,
        onStep: () => undefined,
        onSelect: () => undefined,
        hasPrev: false,
        hasNext: true,
        automation: {
          state: {
            enabled: false,
            enabledProjects: [],
            availability: { status: 'unavailable', cause: 'Disabled for test' },
            evidence: [],
            overrides: [],
          },
          configurationVersion: 1,
          commandInFlight: false,
          execute: async () => {
            throw new Error('not called')
          },
        },
      }),
    )
    const navigation = markup.slice(0, markup.indexOf('</div>'))

    expect(navigation).toContain('aria-label="previous item on the map" disabled=""')
    expect(navigation).toContain('aria-label="next item on the map"')
    expect(navigation).toContain('aria-label="close the panel"')
    expect(navigation).toContain('Chevron%20up')
    expect(navigation).toContain('Chevron%20down')
    expect(navigation).toContain('Chevrons%20right')
    expect(navigation).not.toContain('<svg')
  })
})
