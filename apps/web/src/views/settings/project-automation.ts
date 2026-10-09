import type { ProjectRef } from '@roadmap/contracts/identity'
import type { AutomationEvidence } from '@roadmap/contracts/state'
import { sameProject } from '@/views/shared/settings-shared'

export function unacknowledgedInterruption(
  project: ProjectRef,
  evidence: readonly AutomationEvidence[],
): AutomationEvidence | undefined {
  return evidence.find(
    (entry) =>
      sameProject(entry.target.map.project, project) &&
      entry.wayfinder?.status === 'outcome-unknown' &&
      !entry.wayfinder.acknowledged,
  )
}
