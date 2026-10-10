import type { QueryEnvelope } from '@roadmap/contracts/wire'
export const candidate = { type: 'query', query: { type: 'select-workspace' } } as const
export const invalid = candidate satisfies QueryEnvelope
