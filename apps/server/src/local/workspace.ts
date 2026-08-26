import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface LocalWorkspace {
  path: string
  gitIdentity?: string
}

/** Resolves one readable directory and records a Git-history identity when one exists. */
export async function inspectLocalWorkspace(requestedPath: string): Promise<LocalWorkspace> {
  const path = await realpath(requestedPath)
  const metadata = await stat(path)
  if (!metadata.isDirectory()) throw new Error('not a directory')
  await access(path, constants.R_OK | constants.X_OK)

  const gitIdentity = await readGitIdentity(path)
  return { path, ...(gitIdentity ? { gitIdentity } : {}) }
}

async function readGitIdentity(path: string): Promise<string | undefined> {
  try {
    await execFileAsync('/usr/bin/git', ['-C', path, 'rev-parse', '--show-toplevel'])
    const { stdout } = await execFileAsync('/usr/bin/git', [
      '-C',
      path,
      'rev-list',
      '--max-parents=0',
      '--all',
    ])
    const roots = [
      ...new Set(
        stdout
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].sort()
    return roots.length > 0 ? `git-roots:${roots.join(',')}` : undefined
  } catch {
    return undefined
  }
}
