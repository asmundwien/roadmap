export const candidate = { status: 'launch-failed', admission: 'automatic' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ClassificationAttempt
