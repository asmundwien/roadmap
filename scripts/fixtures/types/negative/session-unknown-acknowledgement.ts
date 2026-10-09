export const candidate = {
  status: 'outcome-unknown',
  admission: 'override',
  reason: 'Interrupted',
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
