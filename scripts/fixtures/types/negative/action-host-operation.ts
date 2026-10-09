import { IDs } from './inputs.ts'
export const candidate = {
  id: IDs.action,
  label: 'Open',
  kind: 'server-launch',
  operation: 'refresh',
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ProjectAction
