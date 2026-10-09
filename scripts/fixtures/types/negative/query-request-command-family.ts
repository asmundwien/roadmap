import { IDs, project } from './inputs.ts'
export const candidate = {
  type: 'refresh-project',
  expectedConfigurationVersion: IDs.version,
  project,
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/operations').Query
