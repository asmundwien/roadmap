import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'begin-github-authorization',
  operationId: IDs.authorization,
  phase: 'waiting',
  verificationUri: 'https://github.com/login/device',
  expiresAt: 1000,
} as const
export const invalid = candidate satisfies CommandResultFor<
  Extract<Command, { type: 'begin-github-authorization' }>
>
