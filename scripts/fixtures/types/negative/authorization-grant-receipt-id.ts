import { IDs } from './inputs.ts'
export const candidate = {
  id: IDs.authorization,
  status: 'granted',
  connection: { kind: 'current', accountId: 'account' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').AuthorizationOperation
