import { IDs } from './inputs.ts'
export const candidate = { id: IDs.action, label: 'Map', kind: 'roadmap' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ProjectAction
