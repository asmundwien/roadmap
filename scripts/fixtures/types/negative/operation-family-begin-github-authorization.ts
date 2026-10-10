import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { project } from './inputs.ts'
export const candidate = {
  type: 'launch-project-operation',
  project,
  operation: 'open-workspace',
  status: 'invoked',
} as const satisfies CommandResultFor<Extract<Command, { type: 'launch-project-operation' }>>
export const invalid = candidate satisfies CommandResultFor<
  Extract<Command, { type: 'begin-github-authorization' }>
>
