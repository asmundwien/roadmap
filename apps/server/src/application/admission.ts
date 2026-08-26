import type { Integration } from '@roadmap/contracts'
import type { AdmissionPort } from './application.ts'

/** Dispatches admission to the Integration named by the candidate. */
export function createProjectAdmission(
  admissions: Partial<Record<Integration, AdmissionPort>>,
): AdmissionPort {
  return {
    admit(candidate, configuration, runtime) {
      const admission = admissions[candidate.integration]
      if (!admission) {
        return Promise.resolve({
          ok: false,
          error: {
            code: 'not-supported' as const,
            field: 'connectionId',
            message: 'That Integration is not available.',
          },
        })
      }
      return admission.admit(candidate, configuration, runtime)
    },
    repair(command, configuration, runtime) {
      const admission = admissions[command.project.integration]
      if (!admission) {
        return Promise.resolve({
          ok: false,
          error: {
            code: 'not-supported' as const,
            field: 'project',
            message: 'That Integration is not available.',
          },
        })
      }
      return admission.repair(command, configuration, runtime)
    },
  }
}
