import type { Command, CommandOutcomeFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  operation: 'remove-project',
  subject: { kind: 'project', project: { integration: 'local', projectId: IDs.connection } },
  serverEpoch: IDs.epoch,
  stateSequence: IDs.sequence,
  ok: false,
  error: { code: 'validation', message: 'Rejected.' },
} as const
export const invalid = candidate satisfies CommandOutcomeFor<
  Extract<Command, { type: 'remove-project' }>
>
