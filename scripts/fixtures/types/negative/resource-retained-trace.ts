export const candidate = { kind: 'retained-unavailable' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').MapResourceResult
