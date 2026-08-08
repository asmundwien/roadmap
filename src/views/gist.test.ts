import { describe, expect, it } from 'vitest'
import { stripInlineMarkdown } from './gist.ts'

describe('stripInlineMarkdown', () => {
  it('flattens emphasis, code ticks, and links to their words', () => {
    expect(
      stripInlineMarkdown(
        'Roadmap v1 is **running locally**: a `pnpm dev` SPA, see [docs](https://example.com).',
      ),
    ).toBe('Roadmap v1 is running locally: a pnpm dev SPA, see docs.')
  })

  it('leaves plain text untouched', () => {
    expect(stripInlineMarkdown('nothing fancy here')).toBe('nothing fancy here')
  })
})
