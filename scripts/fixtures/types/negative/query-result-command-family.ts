import { IDs } from './inputs.ts'
export const candidate = { ok: true, type: 'action-launched', actionId: IDs.action } as const
export const invalid = candidate satisfies import('@roadmap/contracts/operations').QueryResult
