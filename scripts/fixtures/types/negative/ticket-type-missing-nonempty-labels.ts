export const candidate = { kind: 'missing' as const, labels: ['wayfinder:task'] }
export const invalid = candidate satisfies import('@roadmap/contracts/state').TicketTypeEvidence
