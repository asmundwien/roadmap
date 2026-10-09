import { IDs } from './inputs.ts'
export const candidate = { id: IDs.authorization, status: 'granted' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').AuthorizationOperation
