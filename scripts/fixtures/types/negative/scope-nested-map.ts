import { IDs } from './inputs.ts'
export const candidate = { map: { mapId: IDs.map }, ticketId: IDs.ticket } as const
export const invalid = candidate satisfies import('@roadmap/contracts/identity').TicketRef
