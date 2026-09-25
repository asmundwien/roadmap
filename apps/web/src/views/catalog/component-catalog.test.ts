import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PaletteCatalogSection } from './component-catalog'

const COLOR_TOKENS = [
  '--bg',
  '--fg',
  '--muted',
  '--edge',
  '--wash',
  '--trunk',
  '--variant-neutral',
  '--variant-accent',
  '--variant-warning',
  '--variant-danger',
  '--variant-success',
  '--variant-info',
  '--variant-muted',
  '--variant-violet',
  '--variant-teal',
  '--signal-decided',
  '--signal-open',
  '--signal-fog',
  '--state-closed',
  '--state-frontier',
  '--state-claimed',
  '--state-blocked',
  '--type-research',
  '--type-prototype',
  '--type-grilling',
  '--type-task',
  '--automation-classification',
  '--automation-wayfinder',
  '--goal',
] as const

describe('PaletteCatalogSection', () => {
  it('renders every color token in the component palette', () => {
    const markup = renderToStaticMarkup(PaletteCatalogSection())
    const renderedTokens = [...markup.matchAll(/<code>(--[^<]+)<\/code>/g)].map(
      ([, token]) => token,
    )

    expect(renderedTokens).toHaveLength(COLOR_TOKENS.length)
    expect(new Set(renderedTokens)).toEqual(new Set(COLOR_TOKENS))
  })
})
