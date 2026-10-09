import type { ProjectRef } from '@roadmap/contracts/identity'
import type { SafeError } from '@roadmap/contracts/operations'
import type { Project } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { resourceObservation } from './resource-results'

type ErrorTextProps = { error: SafeError | string | null }

export function ErrorText({ error }: ErrorTextProps) {
  if (!error) return null
  return <Alert variant="error">{typeof error === 'string' ? error : error.message}</Alert>
}

export function sameProject(a: ProjectRef, b: ProjectRef): boolean {
  return a.integration === b.integration && a.projectId === b.projectId
}

export function projectIdentity(project: Pick<Project, 'ref'>): string {
  return JSON.stringify([project.ref.integration, project.ref.projectId])
}

export function projectSourceLabel(project: Pick<Project, 'source'>): string {
  return project.source.integration === 'github'
    ? project.source.nameWithOwner
    : project.source.path
}

export function mapState(project: Project): string {
  if (project.activeMap.kind === 'uncertain') return project.activeMap.cause
  const membership = project.mapsMembership
  if (membership.kind !== 'current-complete') return 'Current map membership is unknown.'
  if (membership.observation.value.members.length === 0) return 'No current Wayfinder maps.'
  const open = project.displayOrder.open.length
  const closed = project.displayOrder.closed.length
  const incomplete = project.maps.some(
    (map) =>
      map.resource.kind === 'current-readable' &&
      map.resource.observation.completeness.kind === 'incomplete',
  )
  return `${open} open · ${closed} closed${incomplete ? ' · incomplete source content' : ''}`
}

export function projectObservedAt(project: Project): number | undefined {
  return resourceObservation(project.resource)?.observedAt
}

export function observedLabel(observedAt: number | undefined): string {
  return observedAt === undefined ? 'Not observed yet' : new Date(observedAt).toLocaleString()
}
