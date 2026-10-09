export const candidate = { kind: 'proven-absent' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').MapResourceResult
