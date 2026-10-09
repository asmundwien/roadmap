import { IDs } from './inputs.ts'
export const candidate = {
  phase: 'ready',
  serverEpoch: IDs.epoch,
  stateSequence: IDs.sequence,
  capturedAt: 0,
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ApplicationState
