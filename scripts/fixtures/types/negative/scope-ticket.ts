import { IDs } from './inputs.ts'
export const candidate = { ticketId: IDs.ticket } as const
export const invalid = candidate satisfies import('@roadmap/contracts/identity').TicketRef
