import { IDs } from './inputs.ts'
export const candidate = {
  type: 'configuration-updated',
  configurationVersion: IDs.version,
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/operations').CommandResultFor<
  Extract<import('@roadmap/contracts/operations').Command, { type: 'refresh-project' }>
>
