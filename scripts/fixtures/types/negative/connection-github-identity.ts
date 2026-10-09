import { IDs } from './inputs.ts'
export const candidate = {
  id: IDs.connection,
  integration: 'github',
  name: 'GitHub',
  builtIn: false,
  availability: { status: 'available' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').Connection
