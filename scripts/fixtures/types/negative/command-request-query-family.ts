export const candidate = { type: 'select-workspace' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/operations').Command
