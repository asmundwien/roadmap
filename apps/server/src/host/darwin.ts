import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function selectWorkspace(): Promise<string | null> {
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
export async function launch(executable: string, args: readonly string[]): Promise<void> {
  await execFileAsync(executable, [...args])
}
