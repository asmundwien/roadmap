import type { Command } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'reauthorize-github-connection',
  expectedConfigurationVersion: IDs.version,
} as const
export const invalid = candidate satisfies Command
