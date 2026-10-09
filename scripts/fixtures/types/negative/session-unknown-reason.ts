export const candidate = {
  status: 'outcome-unknown',
  admission: 'automatic',
  acknowledged: true,
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
