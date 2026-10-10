import type { ServerLaunchAction } from '@roadmap/contracts/state'
import { IDs } from './inputs.ts'
export const candidate = {
  id: IDs.action,
  label: 'Open',
  kind: 'server-launch',
  operation: 'open-workspace',
} as const
export const invalid = candidate satisfies ServerLaunchAction
