import { IDs, project } from './inputs.ts'
export const candidate = {
  operation: 'remove-project',
  subject: { kind: 'project', project },
  serverEpoch: IDs.epoch,
  ok: false,
  error: { code: 'validation', message: 'Rejected.' },
} as const
export const invalid =
  candidate satisfies import('@roadmap/contracts/operations').CommandOutcomeFor<
    Extract<import('@roadmap/contracts/operations').Command, { type: 'remove-project' }>
  >
