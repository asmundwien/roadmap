import type { ProjectRef } from '@roadmap/contracts/identity'
import type { Command, SafeError } from '@roadmap/contracts/operations'
import type { Connection, Project } from '@roadmap/contracts/state'

type RegistrationInput = Extract<Command, { type: 'register-project' }>['candidate']

export function projectRegistrationDraft(
  data: FormData,
  connection: Connection | undefined,
  workspacePath: string,
): { candidate: RegistrationInput | null; errors: Record<string, string> } {
  if (!connection) return { candidate: null, errors: { connection: 'Choose a Connection.' } }
  const path = workspacePath.trim()
  if (!path) {
    const field = connection.integration === 'github' ? 'workspace' : 'folder'
    return { candidate: null, errors: { [field]: 'Choose a readable Workspace folder.' } }
  }
  const displayName = String(data.get('displayName') ?? '').trim()
  return {
    errors: {},
    candidate: {
      integration: connection.integration,
      connectionId: connection.id,
      workspace: { path },
      ...(displayName ? { displayName } : {}),
    },
  }
}

export function admittedProjectRef(
  projects: Project[],
  candidate: RegistrationInput,
): ProjectRef | undefined {
  return projects.find(
    (project) =>
      project.ref.integration === candidate.integration &&
      project.connectionId === candidate.connectionId &&
      (project.integration === 'local' ? project.source.path : project.management.workspacePath) ===
        candidate.workspace.path,
  )?.ref
}

export function projectRegistrationError(error: SafeError): {
  fields: Record<string, string>
  general: string | null
} {
  const field = error.field ?? ''
  if (field === 'connectionId') return { fields: { connection: error.message }, general: null }
  if (field.startsWith('workspace')) {
    return { fields: { workspace: error.message, folder: error.message }, general: null }
  }
  return { fields: {}, general: error.message }
}
