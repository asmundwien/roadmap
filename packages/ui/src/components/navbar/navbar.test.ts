import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NavBar, NavBarLink } from './navbar'
import styles from './navbar.module.css'

describe('NavBar', () => {
  it('labels the landmark so several bars on one page stay distinguishable', () => {
    const markup = renderToStaticMarkup(
      NavBar({ label: 'Catalog', children: createElement('span', null, 'x') }),
    )

    expect(markup).toBe(`<nav aria-label="Catalog" class="${styles.navbar}"><span>x</span></nav>`)
  })
})

describe('NavBarLink', () => {
  it('marks the current destination for assistive technology and for the eye', () => {
    const markup = renderToStaticMarkup(
      NavBarLink({ href: '#/a', current: true, children: 'Now here' }),
    )

    expect(markup).toBe(
      `<a aria-current="page" class="${styles.link} ${styles.current}" href="#/a">Now here</a>`,
    )
  })

  it('leaves other destinations unmarked and keeps a caller class name', () => {
    const markup = renderToStaticMarkup(
      NavBarLink({ href: '#/b', className: 'host', children: 'Elsewhere' }),
    )

    expect(markup).toBe(`<a class="${styles.link} host" href="#/b">Elsewhere</a>`)
  })
})
