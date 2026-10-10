import type { CommandEnvelope } from '@roadmap/contracts/wire'
import { IDs, project } from './inputs.ts'
export const candidate = {
  type: 'command',
  correlationId: IDs.connection,
  command: {
    type: 'launch-project-operation',
    expectedConfigurationVersion: IDs.version,
    project,
    operation: 'open-workspace',
  },
} as const
export const invalid = candidate satisfies CommandEnvelope
