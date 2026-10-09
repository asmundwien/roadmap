export const candidate = {
  status: 'finished',
  admission: 'automatic',
  processResult: { status: 'exited', code: 0 },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
