export const candidate = { status: 'queued', admission: 'automatic' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
