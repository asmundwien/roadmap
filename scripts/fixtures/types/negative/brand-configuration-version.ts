import { IDs } from './inputs.ts'
export const candidate = IDs.sequence
export const invalid =
  candidate satisfies import('@roadmap/contracts/identity').ConfigurationVersion
