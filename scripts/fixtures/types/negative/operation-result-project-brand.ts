import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'remove-project',
  project: { integration: 'local', projectId: IDs.connection },
  configurationVersion: IDs.version,
  commit: 'committed',
} as const
export const invalid = candidate satisfies CommandResultFor<
  Extract<Command, { type: 'remove-project' }>
>
