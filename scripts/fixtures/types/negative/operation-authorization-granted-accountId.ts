import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import { IDs } from './inputs.ts'
export const candidate = {
  type: 'begin-github-authorization',
  operationId: IDs.authorization,
  phase: 'granted',
  connection: { connectionId: IDs.connection },
  configurationVersion: IDs.version,
} as const
export const invalid = candidate satisfies CommandResultFor<
  Extract<Command, { type: 'begin-github-authorization' }>
>
