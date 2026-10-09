export const candidate = { kind: 'current-readable' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').MapResourceResult
