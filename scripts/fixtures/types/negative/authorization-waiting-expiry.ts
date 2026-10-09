import { IDs } from './inputs.ts'
export const candidate = {
  id: IDs.authorization,
  status: 'waiting',
  verificationUri: 'https://github.com/login/device',
  userCode: 'code',
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').AuthorizationOperation
