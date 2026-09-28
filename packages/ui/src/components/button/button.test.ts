import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

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
