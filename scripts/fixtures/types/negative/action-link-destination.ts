import { IDs } from './inputs.ts'
export const candidate = { id: IDs.action, label: 'Open', kind: 'external-link' } as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ProjectAction
