import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MapChild } from './map-child.tsx'
import { makeMap } from './test-fixtures.ts'

describe('MapChild', () => {
  it('keeps a closed map collapsed when it is the Project’s only map', () => {
    const map = { ...makeMap([]), isOpen: false, closedAt: 1 }
    const markup = renderToStaticMarkup(
      createElement(MapChild, {
        map,
        automationEvidence: [],
        open: false,
        last: true,
        onSelect: () => undefined,
        onUnfold: () => undefined,
        panelOpen: false,
        selected: null,
        entry: true,
        kbNav: false,
      }),
    )

    expect(markup).not.toContain('fl-block is-open')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-hidden="true"')
  })
})
