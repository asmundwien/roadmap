import { IDs } from './inputs.ts'
export const candidate = { id: IDs.authorization, status: 'terminal', outcome: 'failed' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').AuthorizationOperation
