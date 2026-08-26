import type { ProjectRegistration, ProjectRegistrationCandidate } from '@roadmap/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { RoadmapConfiguration } from '../application/configuration.ts'
import { createLocalProjectAdmission } from './admission.ts'

const LOCAL_CONNECTION: RoadmapConfiguration['connections'][number] = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}
const EMPTY_CONFIGURATION: RoadmapConfiguration = {
  schemaVersion: 5,
  configurationVersion: 1,
  connections: [LOCAL_CONNECTION],
  projects: [],
  automation: { enabled: false, enabledProjects: [] },
}
const RUNTIME = { accessToken: vi.fn(async () => '') }

describe('createLocalProjectAdmission', () => {
  it('canonicalizes one readable folder, records Git identity, and derives a readable route key', async () => {
    const admission = createLocalProjectAdmission({
      inspectWorkspace: async () => ({ path: '/canonical/demo', gitIdentity: 'git-roots:abc' }),
    })

    const result = await admission.admit(
      draft('/linked/demo', '  Demo name  '),
      EMPTY_CONFIGURATION,
      RUNTIME,
    )

    expect(result).toEqual({
      ok: true,
      registration: {
        key: { integration: 'local', id: 'demo' },
        connectionId: 'local',
        locator: { integration: 'local', path: '/canonical/demo' },
        workspace: { path: '/canonical/demo', gitIdentity: 'git-roots:abc' },
        displayName: 'Demo name',
      },
    })
  })

  it('rejects duplicate canonical Workspaces and suffixes only route-key collisions', async () => {
    const inspectWorkspace = vi.fn(async (path: string) => ({ path }))
    const admission = createLocalProjectAdmission({ inspectWorkspace })
    const existing = registration('demo', '/existing')

    const duplicate = await admission.admit(
      draft('/existing'),
      { ...EMPTY_CONFIGURATION, projects: [existing] },
      RUNTIME,
    )
    const collision = await admission.admit(
      draft('/different/demo'),
      { ...EMPTY_CONFIGURATION, projects: [existing] },
      RUNTIME,
    )

    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: 'admission-failed', field: 'workspace.path' },
    })
    expect(collision).toMatchObject({
      ok: true,
      registration: { key: { integration: 'local', id: 'demo-2' } },
    })
  })

  it('repairs only to the same recorded Git identity and refuses non-Git registrations', async () => {
    const inspected = new Map([
      ['/same', { path: '/same', gitIdentity: 'git-roots:abc' }],
      ['/other', { path: '/other', gitIdentity: 'git-roots:def' }],
    ])
    const admission = createLocalProjectAdmission({
      inspectWorkspace: async (path) => {
        const workspace = inspected.get(path)
        if (!workspace) throw new Error('missing')
        return workspace
      },
    })
    const gitProject = registration('git', '/old', 'git-roots:abc')
    const nonGitProject = registration('plain', '/plain')
    const configuration = { ...EMPTY_CONFIGURATION, projects: [gitProject, nonGitProject] }

    await expect(admission.repair(repair('git', '/same'), configuration, RUNTIME)).resolves.toEqual(
      {
        ok: true,
        workspace: { path: '/same', gitIdentity: 'git-roots:abc' },
      },
    )
    await expect(
      admission.repair(repair('git', '/other'), configuration, RUNTIME),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        field: 'workspace.path',
        message: 'That folder does not have the registered Git identity.',
      },
    })
    await expect(
      admission.repair(repair('plain', '/same'), configuration, RUNTIME),
    ).resolves.toMatchObject({
      ok: false,
      error: { field: 'workspace.path', message: expect.stringContaining('Remove it') },
    })
  })
})

function draft(path: string, displayName?: string): ProjectRegistrationCandidate {
  return {
    integration: 'local',
    connectionId: 'local',
    workspace: { path },
    ...(displayName === undefined ? {} : { displayName }),
  }
}

function registration(id: string, path: string, gitIdentity?: string): ProjectRegistration {
  return {
    key: { integration: 'local', id },
    connectionId: 'local',
    locator: { integration: 'local', path },
    workspace: { path, ...(gitIdentity ? { gitIdentity } : {}) },
  }
}

function repair(id: string, path: string) {
  return {
    type: 'repair-project-workspace' as const,
    project: { integration: 'local' as const, id },
    workspace: { path },
    expectedConfigurationVersion: 1,
  }
}
