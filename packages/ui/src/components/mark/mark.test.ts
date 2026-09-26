import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Mark, type MarkProps } from './mark'
import styles from './mark.module.css'

describe('Mark', () => {
  it.each([
    ['large', '32'],
    ['medium', '12'],
    ['small', '0.625em'],
  ] as const)('sizes the %s mark without changing its content', (size, dimension) => {
    const markup = render({ fill: 'solid', size, variant: 'info' })

    expect(markup.startsWith('<svg')).toBe(true)
    expect(markup).toContain(`width="${dimension}"`)
    expect(markup).toContain(`height="${dimension}"`)
    expect(markup).toContain('viewBox="-16 -16 32 32"')
    expect(markup).toContain('aria-hidden="true"')
  })

  it('draws the requested fill, glyph, corners, and accent', () => {
    const markup = render({
      accent: 'warning',
      corners: 2,
      fill: 'half',
      glyph: 'P',
      size: 'large',
      variant: 'info',
    })

    expect(markup).toContain(`class="${styles.mark} ${styles.info} ${styles['corner-warning']}"`)
    expect(markup).toContain(`class="${styles.half}"`)
    expect(markup).toContain('>P</text>')
    expect(markup.match(new RegExp(`class="${styles.corner}"`, 'g'))).toHaveLength(2)
  })

  it('omits the glyph, corners, and accent when the caller leaves them out', () => {
    const markup = render({ fill: 'outline', size: 'medium', variant: 'danger' })

    expect(markup).toContain(`class="${styles.mark} ${styles.danger} ${styles.outline}"`)
    expect(markup).not.toContain('<text')
    expect(markup).not.toContain(styles.corner)
  })

  it('marks the inline size, which is the only size that changes the drawing', () => {
    expect(render({ fill: 'solid', size: 'small', variant: 'neutral' })).toContain(
      `class="${styles.mark} ${styles.neutral} ${styles.small} ${styles.solid}"`,
    )
  })
})

function render(props: MarkProps): string {
  return renderToStaticMarkup(createElement(Mark, props))
}
