import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, ButtonLink } from './button'

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

describe('ButtonLink', () => {
  it('keeps native link navigation for a button-shaped destination', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ButtonLink,
        { href: '#/settings/connections/github%2Fwork/import' },
        'Import project',
      ),
    )

    expect(markup).toMatch(
      /<a [^>]*href="#\/settings\/connections\/github%2Fwork\/import"[^>]*>Import project<\/a>/,
    )
    expect(markup).not.toContain('role="button"')
  })
})
