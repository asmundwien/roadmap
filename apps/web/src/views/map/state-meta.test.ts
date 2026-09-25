import { describe, expect, it } from 'vitest'
import { STATE_META } from './state-meta'

describe('ticket state presentation', () => {
  it.each([
    ['blocked', 'blocked', 'danger', 'none'],
    ['frontier', 'takeable', 'success', 'fill'],
    ['claimed', 'claimed', 'info', 'half'],
    ['closed', 'decided', 'muted', 'fill'],
  ] as const)('maps %s to its word, variant, and fill', (state, word, variant, fill) => {
    expect(STATE_META[state]).toMatchObject({ word, variant, fill })
  })
})
