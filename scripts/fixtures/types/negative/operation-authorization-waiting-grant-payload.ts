import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'begin-github-authorization',
  operationId: IDs.authorization,
  phase: 'waiting',
  verificationUri: 'https://github.com/login/device',
  userCode: 'CODE',
  expiresAt: 1000,
} as const satisfies CommandResultFor<Extract<Command, { type: 'begin-github-authorization' }>>
export const invalid = {
  ...candidate,
  connection: { connectionId: IDs.connection, accountId: 'account' },
} satisfies CommandResultFor<Extract<Command, { type: 'begin-github-authorization' }>>
