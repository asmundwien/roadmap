import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HostExecutor, HostOperationResult, WorkspaceSelection } from './operations.ts'

const execFileAsync = promisify(execFile)

export function createDarwinHostExecutor(): HostExecutor {
  return {
    async execute(operation): Promise<HostOperationResult> {
      switch (operation.type) {
        case 'select-workspace':
          return selectWorkspace()
        case 'open-workspace':
          await execFileAsync('/usr/bin/open', [
            '-a',
            'Visual Studio Code',
            operation.workspacePath,
          ])
          return { kind: 'invoked' }
        case 'open-terminal':
          await execFileAsync('/usr/bin/open', ['-a', 'Terminal', operation.workspacePath])
          return { kind: 'invoked' }
        case 'reveal-source':
          await execFileAsync('/usr/bin/open', ['-R', operation.workspacePath])
          return { kind: 'invoked' }
        default: {
          const exhaustive: never = operation
          throw new Error(`Unknown host operation: ${exhaustive}`)
        }
      }
    },
  }
}

async function selectWorkspace(): Promise<WorkspaceSelection> {
  const script = [
    'try',
    'set selectedFolder to choose folder with prompt "Choose a Workspace"',
    'return "selected" & linefeed & POSIX path of selectedFolder',
    'on error number -128',
    'return "cancelled"',
    'end try',
  ].join('\n')
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script])
  // osascript adds one output newline; POSIX folder aliases add one separator.
  const output = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout
  if (output === 'cancelled') return { kind: 'cancelled' }
  const prefix = 'selected\n'
  if (!output.startsWith(prefix)) throw new Error('The folder selector returned an invalid result.')
  const selected = output.slice(prefix.length)
  const path = selected.length > 1 && selected.endsWith('/') ? selected.slice(0, -1) : selected
  if (!path.startsWith('/')) throw new Error('The folder selector returned an invalid path.')
  return { kind: 'selected', path }
}
