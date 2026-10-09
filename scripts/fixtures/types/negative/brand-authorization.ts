import { IDs } from './inputs.ts'
export const candidate = IDs.action
export const invalid =
  candidate satisfies import('@roadmap/contracts/identity').AuthorizationOperationId
