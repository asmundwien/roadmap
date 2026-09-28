import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Modal } from './modal'

describe('Modal', () => {
  it('gives the dialog an accessible title and a visible non-submitting Close button', () => {
    const markup = renderToStaticMarkup(
      <Modal open title="Delete project" onClose={() => {}}>
        <p>This cannot be undone.</p>
      </Modal>,
    )

    const titleId = /<h2[^>]*id="([^"]+)"[^>]*>Delete project<\/h2>/.exec(markup)?.[1]
    expect(titleId).toBeDefined()
    expect(markup).toMatch(/<dialog[^>]*aria-labelledby="[^"]+"/)
    expect(markup).toContain(`aria-labelledby="${titleId}"`)
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Close<\/button>/)
    expect(markup).toContain('This cannot be undone.')
    expect(markup).not.toContain(' open=""')
  })
})
