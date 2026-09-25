import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Panel } from './panel.tsx'
import { makeMap, ticket } from './test-fixtures.ts'

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
})
