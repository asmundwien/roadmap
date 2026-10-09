import { ticket } from './inputs.ts'
export const candidate = {
  target: ticket,
  classification: {
    status: 'completed',
    admission: 'automatic',
    processResult: { status: 'exited', code: 0 },
    verdict: { value: 'hitl', reason: 'Review' },
  },
  wayfinder: { status: 'queued' },
} as const
export const invalid = candidate satisfies import('@roadmap/contracts/state').AutomationEvidence
