import { IDs } from './inputs.ts'
export const candidate = IDs.authorization
export const invalid = candidate satisfies import('@roadmap/contracts/identity').TicketId
