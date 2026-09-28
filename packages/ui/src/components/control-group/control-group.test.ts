import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from '../button/button'
import { TextInput } from '../text-input/text-input'
import { ControlGroup } from './control-group'

describe('ControlGroup', () => {
  it('accepts conditional buttons without including empty slots', () => {
    const markup = renderToStaticMarkup(
      createElement(ControlGroup, null, false, createElement(Button, null, 'Continue')),
    )
    expect(markup).toContain('<button type="button"')
    expect(markup).toContain('Continue</button>')
  })

  it('renders a text field next to a save button', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ControlGroup,
        null,
        createElement(TextInput, { name: 'title', 'aria-label': 'Title' }),
        createElement(Button, { type: 'submit' }, 'Save'),
      ),
    )
    expect(markup).toMatch(/<input[^>]*name="title"[^>]*\/>/)
    expect(markup).toContain('<button type="submit"')
  })

  it('gives both controls its size even when a child specifies another size', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ControlGroup,
        { size: 'large' },
        createElement(TextInput, { 'aria-label': 'Title', size: 'small' }),
        createElement(Button, { size: 'small' }, 'Save'),
      ),
    )
    expect(markup).toMatch(/<input[^>]*class="[^"]*large[^"]*"/)
    expect(markup).toMatch(/<button[^>]*class="[^"]*large[^"]*"/)
    expect(markup).not.toMatch(/class="[^"]*small[^"]*"/)
  })

  it('rejects links among grouped controls', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ControlGroup, null, createElement('a', { href: '/next' }, 'Next')),
      ),
    ).toThrow(/only Button and TextInput/)
  })
})
