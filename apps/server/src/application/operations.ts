import type { ProjectRef } from '@roadmap/contracts/identity'
import type {
  Command,
  CommandResult,
  Query,
  QueryResult,
  SafeError,
} from '@roadmap/contracts/operations'
import type { WorkspaceAdmission } from '../projects/registry.ts'

type Launch = (executable: string, args: readonly string[]) => Promise<void>
type SelectWorkspace = () => Promise<string | null>
export type OperationCommand = Extract<Command, { type: 'refresh-project' | 'launch-action' }>
export interface OperationContext {
  refresh(project: ProjectRef): Promise<boolean>
  workspace(project: ProjectRef): Promise<WorkspaceAdmission | undefined>
  workspaceAdmissionError(project: ProjectRef): SafeError | null
}
export interface ApplicationOperations {
  query(query: Query): Promise<QueryResult>
  execute(
    command: OperationCommand,
    context: OperationContext,
  ): Promise<{ ok: true; result: CommandResult } | { ok: false; error: SafeError }>
}
export interface ApplicationOperationOptions {
  launch?: Launch
  selectWorkspace?: SelectWorkspace
}

export function createApplicationOperations(
  options: ApplicationOperationOptions = {},
): ApplicationOperations {
  const launch = options.launch
  const selectWorkspace = options.selectWorkspace
  return {
    async query(query) {
      if (query.type !== 'select-workspace' || !selectWorkspace)
        return unsupported('Query is not available.')
      try {
        const selected = (await selectWorkspace())?.trim()
        const path = selected ? (selected === '/' ? selected : selected.replace(/\/+$/, '')) : null
        return { ok: true, type: 'workspace-selection', ...(path ? { path } : {}) }
      } catch {
        return {
          ok: false,
          error: { code: 'selection-failed', message: 'The folder selector could not be opened.' },
        }
      }
    },
    async execute(command, context) {
      if (command.type === 'refresh-project') {
        return (await context.refresh(command.project))
          ? { ok: true, result: { type: 'project-refreshed', project: command.project } }
          : invalid('project', 'Project does not have an active source observer.')
      }
      if (!command.project || !launch) return unsupported('This operation is not available.')
      if (!['open-workspace', 'open-terminal', 'reveal-source'].includes(command.actionId))
        return invalid('actionId', 'That action is not available for this Project.')
      const workspace = await context.workspace(command.project)
      if (!workspace) return invalid('project', 'Project does not exist.')
      if (workspace.status !== 'admitted')
        return {
          ok: false,
          error: {
            code: 'admission-failed',
            field: 'workspace.path',
            message:
              workspace.status === 'unavailable'
                ? workspace.error.message
                : 'Workspace has not been admitted.',
          },
        }
      const args =
        command.actionId === 'open-workspace'
          ? ['-a', 'Visual Studio Code', workspace.proof.path]
          : command.actionId === 'open-terminal'
            ? ['-a', 'Terminal', workspace.proof.path]
            : ['-R', workspace.proof.path]
      const admissionError = context.workspaceAdmissionError(command.project)
      if (admissionError) return { ok: false, error: admissionError }
      try {
        await launch('/usr/bin/open', args)
        return { ok: true, result: { type: 'action-launched', actionId: command.actionId } }
      } catch {
        return {
          ok: false,
          error: {
            code: 'launch-failed',
            field: 'actionId',
            message: 'The requested application could not be opened.',
          },
        }
      }
    },
  }
}

function invalid(field: string, message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'validation', field, message } }
}
function unsupported(message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'not-supported', message } }
}
