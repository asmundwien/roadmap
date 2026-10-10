import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'begin-github-authorization',
  operationId: IDs.authorization,
  phase: 'granted',
  connection: { connectionId: IDs.connection, accountId: 'account' },
  configurationVersion: IDs.version,
} as const satisfies CommandResultFor<Extract<Command, { type: 'begin-github-authorization' }>>
export const invalid = {
  ...candidate,
  verificationUri: 'https://github.com/login/device',
} satisfies CommandResultFor<Extract<Command, { type: 'begin-github-authorization' }>>
