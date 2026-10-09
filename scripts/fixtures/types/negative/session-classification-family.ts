export const candidate = {
  status: 'completed',
  admission: 'automatic',
  processResult: { status: 'exited', code: 0 },
  verdict: { value: 'afk', reason: 'Ready' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
