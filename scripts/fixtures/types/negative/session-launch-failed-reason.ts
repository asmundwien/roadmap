export const candidate = { status: 'launch-failed', admission: 'override' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
