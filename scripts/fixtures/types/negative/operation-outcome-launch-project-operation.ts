import type { Command, CommandOutcomeFor } from '@roadmap/contracts/operations'
import { IDs, project } from './inputs.ts'
export const candidate = {
  operation: 'rename-project',
  subject: { kind: 'project', project },
  serverEpoch: IDs.epoch,
  stateSequence: IDs.sequence,
  ok: true,
  result: {
    type: 'rename-project',
    project,
    configurationVersion: IDs.version,
    commit: 'committed',
  },
} as const satisfies CommandOutcomeFor<Extract<Command, { type: 'rename-project' }>>
export const invalid = candidate satisfies CommandOutcomeFor<
  Extract<Command, { type: 'launch-project-operation' }>
>
