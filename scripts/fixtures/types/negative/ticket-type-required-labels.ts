export const candidate = { kind: 'missing' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').TicketTypeEvidence
