import type { ProjectKey, RegisteredProject, SafeError } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'

type ErrorTextProps = { error: SafeError | string | null }

export function ErrorText({ error }: ErrorTextProps) {
  if (!error) return null
  return <Alert variant="error">{typeof error === 'string' ? error : error.message}</Alert>
}

export function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}

export function projectIdentity(project: Pick<RegisteredProject, 'key'>): string {
  return `${project.key.integration}:${project.key.id}`
}

export function locatorLabel(project: Pick<RegisteredProject, 'locator'>): string {
  return project.locator.integration === 'github'
    ? project.locator.nameWithOwner
    : project.locator.path
}

export function mapState(project: RegisteredProject): string {
  const open = project.openMaps.length
  const closed = project.closedMaps.length
  if (open + closed === 0) return 'No Wayfinder maps yet.'
  if (open === 0) return `${closed} closed ${closed === 1 ? 'map' : 'maps'} · at rest`
  return `${open} open · ${closed} closed`
}

export function observedLabel(observedAt: number | undefined): string {
  return observedAt === undefined ? 'Not observed yet' : new Date(observedAt).toLocaleString()
}
