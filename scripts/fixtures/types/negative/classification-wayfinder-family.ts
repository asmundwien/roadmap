export const candidate = { status: 'queued' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ClassificationAttempt
