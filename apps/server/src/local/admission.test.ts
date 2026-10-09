import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type {
  AdmissionRuntime,
  LocalConnection,
  LocalWorkspaceInspection,
  ProjectAdmissionRequest,
  ProjectRevalidationRequest,
} from '../projects/registry.ts'
import { createLocalProjectAdmission } from './admission.ts'

const LOCAL_CONNECTION: LocalConnection = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}
const RUNTIME: AdmissionRuntime = {
  github: vi.fn(async () => {
    throw new Error('Local inspection must not request GitHub access')
  }),
}

function request(path: string): ProjectAdmissionRequest {
  return { integration: 'local', connection: LOCAL_CONNECTION, path }
}

function revalidation(path: string): ProjectRevalidationRequest {
  return {
    intent: {
      ref: { integration: 'local', projectId: 'plain' },
      connectionId: 'local',
      workspace: { path: '/plain' },
    },
    connection: LOCAL_CONNECTION,
    path,
  }
}

describe('createLocalProjectAdmission', () => {
  it('returns canonical directory and Git history evidence without allocating a Project identity', async () => {
    const inspectWorkspace = vi.fn(
      async () =>
        ({
          integration: 'local',
          path: '/canonical/demo',
          readable: true,
          searchable: true,
          gitIdentity: 'git-roots:abc',
        }) satisfies LocalWorkspaceInspection,
    )
    const admission = createLocalProjectAdmission({ inspectWorkspace })

    const result = await admission.admit(request('/linked/demo'), RUNTIME)

    expect(inspectWorkspace).toHaveBeenCalledWith('/linked/demo')
    expect(result).toEqual({
      integration: 'local',
      workspace: {
        ok: true,
        value: {
          integration: 'local',
          path: '/canonical/demo',
          readable: true,
          searchable: true,
          gitIdentity: 'git-roots:abc',
        },
      },
    })
  })

  it('inspects a real non-Git directory and canonicalizes its symlink for admission and repair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-local-admission-'))
    const alias = `${root}-alias`
    try {
      await symlink(root, alias)
      const canonical = await realpath(root)
      const admission = createLocalProjectAdmission()
      const expected = {
        integration: 'local',
        workspace: {
          ok: true,
          value: { integration: 'local', path: canonical, readable: true, searchable: true },
        },
      }

      await expect(admission.admit(request(alias), RUNTIME)).resolves.toEqual(expected)
      await expect(admission.repair(revalidation(alias), RUNTIME)).resolves.toEqual(expected)
      await expect(admission.revalidate(revalidation(alias), RUNTIME)).resolves.toEqual(expected)
      expect(RUNTIME.github).not.toHaveBeenCalled()
    } finally {
      await rm(alias, { force: true })
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects real missing paths and files rather than claiming directory evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-local-admission-'))
    try {
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      const admission = createLocalProjectAdmission()
      for (const path of [join(root, 'missing'), file]) {
        await expect(admission.admit(request(path), RUNTIME)).resolves.toMatchObject({
          integration: 'local',
          workspace: {
            ok: false,
            error: { code: 'admission-failed', field: 'workspace.path' },
          },
        })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
