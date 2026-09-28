import type {
  Connection,
  ProjectKey,
  ProjectRegistrationCandidate,
  RegisteredProject,
  SafeError,
} from '@roadmap/contracts'

export function projectRegistrationDraft(
  data: FormData,
  connection: Connection | undefined,
  workspacePath: string,
): { candidate: ProjectRegistrationCandidate | null; errors: Record<string, string> } {
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

export function admittedProjectKey(
  projects: RegisteredProject[],
  candidate: ProjectRegistrationCandidate,
): ProjectKey | undefined {
  return projects.find(
    (project) =>
      project.key.integration === candidate.integration &&
      project.connectionId === candidate.connectionId &&
      project.workspace.path === candidate.workspace.path,
  )?.key
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
