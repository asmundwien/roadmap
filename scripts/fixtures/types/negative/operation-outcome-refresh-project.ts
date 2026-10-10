import type { Command, CommandOutcomeFor } from '@roadmap/contracts/operations'
import { IDs, project } from './inputs.ts'
export const candidate = {
  operation: 'launch-project-operation',
  subject: { kind: 'project', project },
  serverEpoch: IDs.epoch,
  stateSequence: IDs.sequence,
  ok: true,
  result: {
    type: 'launch-project-operation',
    project,
    operation: 'open-workspace',
    status: 'invoked',
  },
} as const satisfies CommandOutcomeFor<Extract<Command, { type: 'launch-project-operation' }>>
export const invalid = candidate satisfies CommandOutcomeFor<
  Extract<Command, { type: 'refresh-project' }>
>
