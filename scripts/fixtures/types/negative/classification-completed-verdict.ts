export const candidate = {
  status: 'completed',
  admission: 'automatic',
  processResult: { status: 'exited', code: 0 },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ClassificationAttempt
