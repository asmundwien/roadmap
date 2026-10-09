import type { ProjectKey, RegisteredProject, SafeError } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { resourceObservation } from './resource-results'

type ErrorTextProps = { error: SafeError | string | null }

export function ErrorText({ error }: ErrorTextProps) {
  if (!error) return null
  return <Alert variant="error">{typeof error === 'string' ? error : error.message}</Alert>
}

export function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}

export function projectIdentity(project: Pick<RegisteredProject, 'key'>): string {
  return JSON.stringify([project.key.integration, project.key.id])
}

export function locatorLabel(project: Pick<RegisteredProject, 'locator'>): string {
  return project.locator.integration === 'github'
    ? project.locator.nameWithOwner
    : project.locator.path
}

export function mapState(project: RegisteredProject): string {
  if (project.activeMap.kind === 'uncertain') return project.activeMap.cause
  const membership = project.mapsMembership
  if (membership.kind !== 'current-complete') return 'Current map membership is unknown.'
  if (membership.observation.value.members.length === 0) return 'No current Wayfinder maps.'
  const open = project.displayOrder.openMapIds.length
  const closed = project.displayOrder.closedMapIds.length
  const incomplete = project.maps.some(
    (map) =>
      map.resource.kind === 'current-readable' &&
      map.resource.observation.completeness.kind === 'incomplete',
  )
  return `${open} open · ${closed} closed${incomplete ? ' · incomplete source content' : ''}`
}

export function projectObservedAt(project: RegisteredProject): number | undefined {
  return resourceObservation(project.resource)?.observedAt
}

export function observedLabel(observedAt: number | undefined): string {
  return observedAt === undefined ? 'Not observed yet' : new Date(observedAt).toLocaleString()
}
