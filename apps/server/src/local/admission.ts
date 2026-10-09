import type {
  AdmissionFailure,
  AdmissionOutcome,
  ConfiguredConnection,
  EvidenceResult,
  LocalWorkspaceInspection,
  ProjectAdmission,
} from '../projects/registry.ts'
import { inspectLocalWorkspace } from './workspace.ts'

export interface LocalAdmissionOptions {
  inspectWorkspace?: (path: string) => Promise<LocalWorkspaceInspection>
}

type LocalAdmissionOutcome = Extract<AdmissionOutcome, { integration: 'local' }>

/** Inspects directories. Registry policy owns identity, occupancy and repair history. */
export function createLocalProjectAdmission(options: LocalAdmissionOptions = {}): ProjectAdmission {
  const inspectWorkspace = options.inspectWorkspace ?? inspectLocalWorkspace

  async function inspect(
    integration: 'local' | 'github',
    connection: ConfiguredConnection,
    path: string,
  ): Promise<LocalAdmissionOutcome> {
    if (integration !== 'local') {
      return failed('integration', 'This admission path accepts only Local Projects.')
    }
    if (connection.integration !== 'local' || !connection.builtIn) {
      return failed('connectionId', 'The built-in Local Connection does not exist.')
    }
    let workspace: EvidenceResult<LocalWorkspaceInspection>
    try {
      workspace = { ok: true, value: await inspectWorkspace(path) }
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      workspace = {
        ok: false,
        error: {
          code: 'admission-failed',
          field: 'workspace.path',
          message: 'Choose a readable and searchable local folder.',
          filesystemCode: code === 'ENOENT' || code === 'EACCES' ? code : 'other',
        },
      }
    }
    return { integration: 'local', workspace }
  }

  return {
    admit(request) {
      return inspect(request.integration, request.connection, request.path)
    },
    repair(request) {
      return inspect(request.intent.ref.integration, request.connection, request.path)
    },
    revalidate(request) {
      return inspect(request.intent.ref.integration, request.connection, request.path)
    },
  }
}

function failed(field: string, message: string): LocalAdmissionOutcome {
  const error: AdmissionFailure = { code: 'admission-failed', field, message }
  return { integration: 'local', workspace: { ok: false, error } }
}
