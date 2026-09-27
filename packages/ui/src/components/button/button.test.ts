import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, ButtonGroup } from './button'

describe('Button', () => {
  it('defaults to a non-submitting button and permits explicit form submission', () => {
    expect(renderToStaticMarkup(createElement(Button, null, 'Cancel'))).toContain(
      '<button type="button"',
    )
    expect(renderToStaticMarkup(createElement(Button, { type: 'submit' }, 'Save'))).toContain(
      '<button type="submit"',
    )
  })

  it('passes the native disabled state through to the button', () => {
    expect(
      renderToStaticMarkup(createElement(Button, { disabled: true }, 'Unavailable')),
    ).toContain('disabled=""')
  })
})

describe('ButtonGroup', () => {
  it('accepts conditional buttons without including empty slots', () => {
    const markup = renderToStaticMarkup(
      createElement(ButtonGroup, null, false, createElement(Button, null, 'Continue')),
    )
    expect(markup).toContain('<button type="button"')
    expect(markup).toContain('Continue</button>')
  })

  it('rejects links among grouped buttons', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ButtonGroup, null, createElement('a', { href: '/next' }, 'Next')),
      ),
    ).toThrow('ButtonGroup accepts only Button children')
  })
})
