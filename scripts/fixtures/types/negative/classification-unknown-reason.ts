export const candidate = { status: 'outcome-unknown', admission: 'override' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ClassificationAttempt
