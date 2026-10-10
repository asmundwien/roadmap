import type { Command } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'launch-project-operation',
  expectedConfigurationVersion: IDs.version,
  operation: 'open-workspace',
} as const
export const invalid = candidate satisfies Command
