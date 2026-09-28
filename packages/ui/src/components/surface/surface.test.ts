import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Surface, SurfaceDescription, SurfaceTitle } from './surface'

describe('Surface', () => {
  it('changes emphasis without turning content into an alert or section landmark', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Surface,
        { variant: 'emphasized', id: 'project', 'aria-labelledby': 'project-title' },
        createElement(SurfaceTitle, { id: 'project-title' }, 'Project'),
        createElement(SurfaceDescription, null, 'Ready to open'),
      ),
    )

    expect(markup).toContain('aria-labelledby="project-title"')
    expect(markup).toMatch(/<h3[^>]*id="project-title"[^>]*>Project<\/h3>/)
    expect(markup).not.toContain('<section')
    expect(markup).not.toContain('role="alert"')
  })
})
