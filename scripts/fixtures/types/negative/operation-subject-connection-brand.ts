import type { Command, CommandOutcomeFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  operation: 'remove-connection',
  subject: { kind: 'connection', connectionId: IDs.project },
  serverEpoch: IDs.epoch,
  stateSequence: IDs.sequence,
  ok: false,
  error: { code: 'validation', message: 'Rejected.' },
} as const
export const invalid = candidate satisfies CommandOutcomeFor<
  Extract<Command, { type: 'remove-connection' }>
>
