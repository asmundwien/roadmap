import { IDs } from './inputs.ts'
export const candidate = {
  id: IDs.connection,
  integration: 'local',
  name: 'Local',
  builtIn: false,
  availability: { status: 'available' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').Connection
