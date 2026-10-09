import { IDs } from './inputs.ts'
export const candidate = IDs.connection
export const invalid = candidate satisfies import('@roadmap/contracts/identity').CorrelationId
