import { describe, expect, it } from 'vitest'
import { parseDecision, parseMapBody } from './map-body.ts'

const TEMPLATE_BODY = `## Destination

Roadmap v1 is **running locally**: a Vite SPA that discovers every wayfinder project.

## Notes

- **Execution override:** this map carries the build.
- Stack decided at charting: TypeScript, Vite, React.

## Decisions so far

<!-- one line per closed ticket: [title](link) — gist -->
- [Research: reading wayfinder primitives](https://github.com/a/r/issues/2) — no backend needed.
- [Scaffold the app](https://github.com/a/r/issues/4) — the shell runs: Vite 8 + React 19.

## Not yet specified

- Test strategy — the scaffold deliberately ships no runner.
- Packaging: does this stay \`pnpm dev\`?

## Out of scope

- Write actions — claiming, closing, or editing tickets from the tool.
`

describe('parseMapBody', () => {
  it('reads every template section off a well-formed map', () => {
    const body = parseMapBody(TEMPLATE_BODY)

    expect(body.destination).toContain('Roadmap v1 is **running locally**')
    expect(body.notes).toHaveLength(2)
    expect(body.decisions).toHaveLength(2)
    expect(body.notYetSpecified).toHaveLength(2)
    expect(body.outOfScope).toEqual([
      'Write actions — claiming, closing, or editing tickets from the tool.',
    ])
    expect(body.missingSections).toEqual([])
  })

  it('drops the template guidance comments rather than reading them as content', () => {
    const body = parseMapBody(TEMPLATE_BODY)
    expect(body.decisions.some((decision) => decision.raw.includes('one line per closed'))).toBe(
      false,
    )
  })

  it('keeps the raw body and every section, so drift stays inspectable', () => {
    const body = parseMapBody(`${TEMPLATE_BODY}\n## Parking lot\n\n- something new\n`)

    expect(body.raw).toContain('Parking lot')
    expect(body.sections.map((section) => section.heading)).toEqual([
      'Destination',
      'Notes',
      'Decisions so far',
      'Not yet specified',
      'Out of scope',
      'Parking lot',
    ])
  })

  it('reports missing template sections instead of failing', () => {
    const body = parseMapBody('## Destination\n\nSomewhere.\n')

    expect(body.destination).toBe('Somewhere.')
    expect(body.decisions).toEqual([])
    expect(body.missingSections).toEqual([
      'Notes',
      'Decisions so far',
      'Not yet specified',
      'Out of scope',
    ])
  })

  it('survives an empty body', () => {
    const body = parseMapBody('')
    expect(body.sections).toEqual([])
    expect(body.notes).toEqual([])
    expect(body.missingSections).toHaveLength(5)
  })

  it('accepts heading drift', () => {
    const body = parseMapBody(
      '## Decisions\n\n- [A](https://x/1) — did a thing\n\n## Fog of war\n\n- unclear\n',
    )

    expect(body.decisions[0]?.title).toBe('A')
    expect(body.notYetSpecified).toEqual(['unclear'])
  })

  it('falls back to paragraphs when a list section drifted into prose', () => {
    const body = parseMapBody('## Notes\n\nFirst thought.\n\nSecond thought.\n')
    expect(body.notes).toEqual(['First thought.', 'Second thought.'])
  })

  it('joins a bullet with its wrapped continuation lines', () => {
    const body = parseMapBody('## Out of scope\n\n- Hosting and\n  multi-viewer sharing.\n')
    expect(body.outOfScope).toEqual(['Hosting and multi-viewer sharing.'])
  })

  it('does not let a deeper heading start a new section', () => {
    const body = parseMapBody('## Notes\n\n### Sub\n\n- one\n')
    expect(body.sections).toHaveLength(1)
    expect(body.notes).toEqual(['one'])
  })

  it('keeps the first of two identical headings', () => {
    const body = parseMapBody('## Notes\n\n- original\n\n## Notes\n\n- duplicate\n')
    expect(body.notes).toEqual(['original'])
  })
})

describe('parseDecision', () => {
  it('splits a linked entry into title, url, and gist', () => {
    const decision = parseDecision(
      '[Scaffold the app](https://github.com/a/r/issues/4) — the shell runs',
    )

    expect(decision).toMatchObject({
      title: 'Scaffold the app',
      url: 'https://github.com/a/r/issues/4',
      gist: 'the shell runs',
    })
  })

  it('accepts a plain hyphen as the separator', () => {
    expect(parseDecision('[A](https://x/1) - gist here').gist).toBe('gist here')
  })

  it('handles a link with no gist', () => {
    expect(parseDecision('[A](https://x/1)')).toMatchObject({ title: 'A', gist: '' })
  })

  it('reads an unlinked entry as title and gist', () => {
    expect(parseDecision('Some decision — its gist')).toMatchObject({
      title: 'Some decision',
      url: null,
      gist: 'its gist',
    })
  })

  it('keeps an unparseable line whole rather than losing it', () => {
    const decision = parseDecision('just some prose')
    expect(decision).toMatchObject({ title: 'just some prose', url: null, gist: '' })
    expect(decision.raw).toBe('just some prose')
  })
})
