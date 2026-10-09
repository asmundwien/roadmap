import { ticket } from './inputs.ts'
export const candidate = {
  target: ticket,
  classification: { status: 'running', admission: 'automatic' },
  wayfinder: { status: 'queued' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').AutomationEvidence
