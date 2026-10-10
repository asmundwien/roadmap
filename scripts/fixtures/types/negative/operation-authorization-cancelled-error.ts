import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'cancel-github-authorization',
  operationId: IDs.authorization,
  phase: 'cancelled',
} as const satisfies CommandResultFor<Extract<Command, { type: 'cancel-github-authorization' }>>
export const invalid = {
  ...candidate,
  error: { code: 'authorization-failed', message: 'Failed.' },
} satisfies CommandResultFor<Extract<Command, { type: 'cancel-github-authorization' }>>
