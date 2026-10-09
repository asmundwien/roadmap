import { IDs } from './inputs.ts'
export const candidate = {
  id: IDs.authorization,
  status: 'granted',
  connection: { kind: 'historical', id: IDs.connection },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').AuthorizationOperation
