import type { AutomationEvidence } from '@roadmap/contracts/state'
import { ticket } from './inputs.ts'
export const invalid = {
  target: ticket,
  classification: {
    status: 'completed',
    admission: 'automatic',
    processResult: { status: 'exited', code: 0 },
    verdict: { value: 'afk', reason: 'Queued by replay.' },
  },
} satisfies AutomationEvidence
