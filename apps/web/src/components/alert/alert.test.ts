import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Alert } from './alert'

describe('Alert', () => {
  it('renders the requested tone and alert semantics', () => {
    expect(renderToStaticMarkup(Alert({ variant: 'error', children: 'Failed' }))).toContain(
      'class="alert alert-error" role="alert"',
    )
    expect(renderToStaticMarkup(Alert({ variant: 'info', children: 'Saved' }))).not.toContain(
      'role="alert"',
    )
  })
})
