import type { SafeError } from '@roadmap/contracts/operations'
import type { Project } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'

type ErrorTextProps = { error: SafeError | string | null }

export function ErrorText({ error }: ErrorTextProps) {
  if (!error) return null
  return <Alert variant="error">{typeof error === 'string' ? error : error.message}</Alert>
}

export function projectIdentity(project: Pick<Project, 'ref'>): string {
  return JSON.stringify([project.ref.integration, project.ref.projectId])
}

export function observedLabel(observedAt: number | null | undefined): string {
  return observedAt === undefined || observedAt === null
    ? 'Not observed yet'
    : new Date(observedAt).toLocaleString()
}
