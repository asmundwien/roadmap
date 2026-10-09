import { IDs } from './inputs.ts'
export const candidate = { type: 'action-launched', actionId: IDs.action } as const
export const invalid = candidate satisfies import('@roadmap/contracts/operations').CommandResultFor<
  Extract<import('@roadmap/contracts/operations').Command, { type: 'rename-connection' }>
>
