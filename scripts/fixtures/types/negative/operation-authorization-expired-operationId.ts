import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
export const candidate = { type: 'begin-github-authorization', phase: 'expired' } as const
export const invalid = candidate satisfies CommandResultFor<
  Extract<Command, { type: 'begin-github-authorization' }>
>
