import { IDs } from './inputs.ts'
export const candidate = { projectId: IDs.project } as const
export const invalid = candidate satisfies import('@roadmap/contracts/identity').ProjectRef
