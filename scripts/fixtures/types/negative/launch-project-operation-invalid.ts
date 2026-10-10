import type { Command } from '@roadmap/contracts/operations'
import { IDs, project } from './inputs.ts'
export const candidate = {
  type: 'launch-project-operation',
  expectedConfigurationVersion: IDs.version,
  project,
  operation: 'refresh',
} as const
export const invalid = candidate satisfies Command
