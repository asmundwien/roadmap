import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'register-project',
  project: { projectId: IDs.project },
  connectionId: IDs.connection,
  workspacePath: '/canonical',
  configurationVersion: IDs.version,
  commit: 'committed',
} as const
export const invalid = candidate satisfies CommandResultFor<
  Extract<Command, { type: 'register-project' }>
>
