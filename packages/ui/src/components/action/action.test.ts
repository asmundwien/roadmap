import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Action, ActionGroup } from './action'
import styles from './action.module.css'

describe('Action', () => {
  it('renders button and link variants through one interface', () => {
    expect(renderToStaticMarkup(createElement(Action, { variant: 'strong' }, 'Save'))).toContain(
      `<button type="button" class="${styles.action} ${styles.strong}">Save</button>`,
    )
    expect(
      renderToStaticMarkup(
        createElement(
          Action,
          { element: 'link', href: 'https://example.test', variant: 'danger' },
          'Remove',
        ),
      ),
    ).toContain(`class="${styles.action} ${styles.danger}"`)
  })

  it('leaves the default variant and size on the base treatment alone', () => {
    expect(renderToStaticMarkup(createElement(Action, null, 'Save'))).toContain(
      `class="${styles.action}"`,
    )
    expect(renderToStaticMarkup(createElement(Action, { size: 'field' }, 'Save'))).toContain(
      `class="${styles.action} ${styles.field}"`,
    )
  })

  it('owns layout variants for related actions', () => {
    expect(
      renderToStaticMarkup(
        ActionGroup({ variant: 'form', children: createElement(Action, null, 'Save') }),
      ),
    ).toContain(`class="${styles.group} ${styles['group-form']}"`)
  })
})
