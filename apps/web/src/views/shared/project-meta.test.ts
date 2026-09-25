import { describe, expect, it } from 'vitest'
import { INTEGRATION_META, integrationLabel } from './project-meta.ts'

describe('integration presentation', () => {
  it('uses human-facing labels and generic badge variants', () => {
    expect(INTEGRATION_META.github).toEqual({ label: 'GitHub', badgeVariant: 'accent' })
    expect(INTEGRATION_META.local).toEqual({ label: 'Local', badgeVariant: 'warning' })
    expect(integrationLabel('github')).toBe('GitHub')
    expect(integrationLabel('local')).toBe('Local')
  })
})
