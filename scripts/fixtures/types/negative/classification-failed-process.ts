export const candidate = { status: 'failed', admission: 'automatic', reason: 'Failed' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ClassificationAttempt
