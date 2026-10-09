import { IDs } from './inputs.ts'
export const candidate = {
  phase: 'failed',
  serverEpoch: IDs.epoch,
  stateSequence: IDs.sequence,
  capturedAt: 0,
  retained: null,
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').ApplicationState
