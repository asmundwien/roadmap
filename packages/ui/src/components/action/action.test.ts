import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Action, ActionGroup } from './action'

describe('Action', () => {
  it('renders button and link variants through one interface', () => {
    expect(renderToStaticMarkup(createElement(Action, { variant: 'strong' }, 'Save'))).toContain(
      '<button type="button" class="action action-strong">Save</button>',
    )
    expect(
      renderToStaticMarkup(
        createElement(
          Action,
          { element: 'link', href: 'https://example.test', variant: 'danger' },
          'Remove',
        ),
      ),
    ).toContain('class="action action-danger"')
  })

  it('owns layout variants for related actions', () => {
    expect(
      renderToStaticMarkup(
        ActionGroup({ variant: 'form', children: createElement(Action, null, 'Save') }),
      ),
    ).toContain('class="action-group action-group-form"')
  })
})
