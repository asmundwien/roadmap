export const candidate = { status: 'launch-failed', reason: 'Failed' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
