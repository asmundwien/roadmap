export const candidate = { status: 'running' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
