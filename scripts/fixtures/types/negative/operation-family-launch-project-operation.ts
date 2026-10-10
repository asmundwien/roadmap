import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { IDs, project } from './inputs.ts'
export const candidate = {
  type: 'rename-project',
  project,
  configurationVersion: IDs.version,
  commit: 'committed',
} as const satisfies CommandResultFor<Extract<Command, { type: 'rename-project' }>>
export const invalid = candidate satisfies CommandResultFor<
  Extract<Command, { type: 'launch-project-operation' }>
>
