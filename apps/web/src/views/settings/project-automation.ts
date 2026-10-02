import type { AutomationEvidence, ProjectKey } from '@roadmap/contracts'
import { sameProject } from '@/views/shared/settings-shared'

export function unacknowledgedInterruption(
  project: ProjectKey,
  evidence: readonly AutomationEvidence[],
): AutomationEvidence | undefined {
  return evidence.find(
    (entry) =>
      sameProject(entry.target.project, project) &&
      entry.wayfinder?.status === 'outcome-unknown' &&
      !entry.wayfinder.acknowledged,
  )
}
