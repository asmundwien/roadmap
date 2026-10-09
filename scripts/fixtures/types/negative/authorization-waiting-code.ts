import { IDs } from './inputs.ts'
export const candidate = {
  id: IDs.authorization,
  status: 'waiting',
  verificationUri: 'https://github.com/login/device',
  expiresAt: 1,
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').AuthorizationOperation
