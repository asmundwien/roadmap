import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Alert } from './alert'
import styles from './alert.module.css'

describe('Alert', () => {
  it('renders the requested tone and alert semantics', () => {
    expect(renderToStaticMarkup(Alert({ variant: 'error', children: 'Failed' }))).toContain(
      `class="${styles.alert} ${styles.error}" role="alert"`,
    )
    expect(renderToStaticMarkup(Alert({ variant: 'info', children: 'Saved' }))).not.toContain(
      'role="alert"',
    )
  })
})
