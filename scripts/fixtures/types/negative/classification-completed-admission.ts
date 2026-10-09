export const candidate = {
  status: 'completed',
  processResult: { status: 'exited', code: 0 },
  verdict: { value: 'afk', reason: 'Ready' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ClassificationAttempt
