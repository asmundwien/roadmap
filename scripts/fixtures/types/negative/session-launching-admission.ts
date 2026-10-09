export const candidate = { status: 'launching' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').WayfinderSession
