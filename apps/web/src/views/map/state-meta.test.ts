import { describe, expect, it } from 'vitest'
import { STATE_META } from './state-meta.ts'

describe('ticket state presentation', () => {
  it.each([
    ['blocked', 'blocked', 'danger'],
    ['frontier', 'takeable', 'success'],
    ['claimed', 'claimed', 'info'],
    ['closed', 'decided', 'muted'],
  ] as const)('maps %s to its word and generic badge variant', (state, word, badgeVariant) => {
    expect(STATE_META[state]).toMatchObject({ word, badgeVariant })
  })
})
