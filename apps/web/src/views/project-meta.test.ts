import { describe, expect, it } from 'vitest'
import { integrationLabel } from './project-meta.ts'

describe('integrationLabel', () => {
  it('uses human-facing project badge labels', () => {
    expect(integrationLabel('github')).toBe('GitHub')
    expect(integrationLabel('local')).toBe('Local')
  })
})
