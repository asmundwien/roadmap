import { IDs } from './inputs.ts'
export const candidate = IDs.version
export const invalid = candidate satisfies import('@roadmap/contracts/identity').StateSequence
