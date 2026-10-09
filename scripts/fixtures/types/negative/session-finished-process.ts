export const candidate = {
  status: 'finished',
  admission: 'automatic',
  report: { status: 'missing', reason: 'No report' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
