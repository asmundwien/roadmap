import { IDs } from './inputs.ts'
export const candidate = { mapId: IDs.map } as const
export const invalid = candidate satisfies import('@roadmap/contracts/identity').MapRef
