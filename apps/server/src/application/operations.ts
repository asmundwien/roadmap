import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProjectKey, SafeError } from '@roadmap/contracts'
import type { ApplicationOperations } from './application.ts'

const execFileAsync = promisify(execFile)

type Launch = (executable: string, args: readonly string[]) => Promise<void>
type SelectWorkspace = () => Promise<string | null>

export interface ApplicationOperationOptions {
  refreshGitHub?: (project: ProjectKey) => Promise<boolean>
  launch?: Launch
  selectWorkspace?: SelectWorkspace
}

type OperationCommand = Parameters<ApplicationOperations['execute']>[0]
type OperationState = Parameters<ApplicationOperations['execute']>[1]

export function createApplicationOperations(
  options: ApplicationOperationOptions = {},
): ApplicationOperations {
  const launch = options.launch ?? defaultLaunch
  const selectWorkspace = options.selectWorkspace ?? defaultSelectWorkspace

  return {
    async query(query) {
      if (query.type === 'select-workspace') return selectWorkspaceQuery(selectWorkspace)
      return { ok: false, error: { code: 'not-supported', message: 'Query is not available.' } }
    },
    execute(command, state) {
      if (command.type === 'refresh-project') {
        return refreshProject(command, options.refreshGitHub)
      }
      if (command.type === 'launch-action') return launchAction(command, state, launch)
      return Promise.resolve(unsupported('This operation is not available.'))
    },
  }
}
async function selectWorkspaceQuery(selectWorkspace: SelectWorkspace) {
  try {
    const selected = (await selectWorkspace())?.trim()
    const path = selected ? normalizedFolderPath(selected) : null
    return {
      ok: true as const,
      type: 'workspace-selection' as const,
      ...(path ? { path } : {}),
    }
  } catch {
    return {
      ok: false as const,
      error: {
        code: 'selection-failed' as const,
        message: 'The folder selector could not be opened.',
      },
    }
  }
}

async function refreshProject(
  command: Extract<OperationCommand, { type: 'refresh-project' }>,
  refreshGitHub: ApplicationOperationOptions['refreshGitHub'],
) {
  if (command.project.integration !== 'github' || !refreshGitHub) {
    return invalid('project', 'GitHub Project does not exist.')
  }
  return (await refreshGitHub(command.project))
    ? {
        ok: true as const,
        result: { type: 'project-refreshed' as const, project: command.project },
      }
    : invalid('project', 'GitHub Project does not exist.')
}

async function launchAction(
  command: Extract<OperationCommand, { type: 'launch-action' }>,
  state: OperationState,
  launch: Launch,
) {
  if (!command.project) return unsupported('This operation is not available.')
  const projectKey = command.project
  const registration = state.registrations.find((project) => sameProject(project.key, projectKey))
  if (!registration) return invalid('project', 'Project does not exist.')
  const launchSpec =
    command.actionId === 'open-workspace'
      ? {
          executable: '/usr/bin/open',
          args: ['-a', 'Visual Studio Code', registration.workspace.path],
        }
      : command.actionId === 'reveal-source' && registration.locator.integration === 'local'
        ? { executable: '/usr/bin/open', args: ['-R', registration.locator.path] }
        : null
  if (!launchSpec) return invalid('actionId', 'That action is not available for this Project.')

  try {
    await launch(launchSpec.executable, launchSpec.args)
    return {
      ok: true as const,
      result: { type: 'action-launched' as const, actionId: command.actionId },
    }
  } catch {
    return {
      ok: false as const,
      error: {
        code: 'launch-failed' as const,
        field: 'actionId',
        message: 'The requested application could not be opened.',
      },
    }
  }
}

async function defaultSelectWorkspace(): Promise<string | null> {
  const script = [
    'try',
    'set selectedFolder to choose folder with prompt "Choose a Workspace"',
    'return POSIX path of selectedFolder',
    'on error number -128',
    'return ""',
    'end try',
  ].join('\n')
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script])
  return stdout
}

function normalizedFolderPath(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '')
}

async function defaultLaunch(executable: string, args: readonly string[]): Promise<void> {
  await execFileAsync(executable, [...args])
}

function sameProject(first: ProjectKey, second: ProjectKey): boolean {
  return first.integration === second.integration && first.id === second.id
}

function invalid(field: string, message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'validation', field, message } }
}

function unsupported(message: string): { ok: false; error: SafeError } {
  return { ok: false, error: { code: 'not-supported', message } }
}
