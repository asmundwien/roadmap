export const candidate = {
  status: 'outcome-unknown',
  reason: 'Interrupted',
  acknowledged: false,
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
