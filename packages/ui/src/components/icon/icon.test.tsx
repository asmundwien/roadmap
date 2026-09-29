import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Icon, icon } from './icon'

describe('Icon', () => {
  it('renders distinct decorative symbols without changing a button label', () => {
    const plus = renderToStaticMarkup(
      createElement('button', { type: 'button' }, createElement(Icon, { icon: icon.plus }), 'Add'),
    )
    const trash = renderToStaticMarkup(
      createElement(
        'button',
        { type: 'button' },
        createElement(Icon, { icon: icon.trash }),
        'Delete',
      ),
    )

    expect(plus).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>Add<\/button>/)
    expect(trash).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>Delete<\/button>/)
    expect(plus).toContain('mask-image:')
    expect(trash).toContain('mask-image:')
    expect(plus).not.toContain('undefined')
    expect(trash).not.toContain('undefined')
    expect(plus.match(/mask-image:[^"]+/)?.[0]).not.toBe(trash.match(/mask-image:[^"]+/)?.[0])
  })
})
