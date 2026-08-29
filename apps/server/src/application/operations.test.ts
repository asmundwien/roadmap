import type { ApplicationState, ProjectRegistration } from '@roadmap/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createApplicationOperations } from './operations.ts'

const LOCAL: ProjectRegistration = {
  key: { integration: 'local', id: 'demo' },
  connectionId: 'local',
  locator: { integration: 'local', path: '/committed/source' },
  workspace: { path: '/committed/workspace' },
}

function state(): ApplicationState {
  return {
    serverEpoch: 'test',
    stateSequence: 1,
    configurationVersion: 1,
    supportedIntegrations: [],
    connections: [],
    registrations: [LOCAL],
    projects: [],
    authorizationOperations: [],
    configuration: { valid: true, issues: [], notices: [] },
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
    roadmap: { capturedAt: 1, projects: [], unreachable: [] },
  }
}

describe('createApplicationOperations', () => {
  it('returns a native folder selection and treats cancellation as no selection', async () => {
    const selectWorkspace = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('/selected/workspace/')
      .mockResolvedValueOnce(null)
    const operations = createApplicationOperations({ selectWorkspace })

    await expect(operations.query({ type: 'select-workspace' }, state())).resolves.toEqual({
      ok: true,
      type: 'workspace-selection',
      path: '/selected/workspace',
    })
    await expect(operations.query({ type: 'select-workspace' }, state())).resolves.toEqual({
      ok: true,
      type: 'workspace-selection',
    })
  })

  it('reports a safe error when the native folder selector cannot open', async () => {
    const operations = createApplicationOperations({
      selectWorkspace: async () => {
        throw new Error('private platform detail')
      },
    })

    await expect(operations.query({ type: 'select-workspace' }, state())).resolves.toEqual({
      ok: false,
      error: {
        code: 'selection-failed',
        message: 'The folder selector could not be opened.',
      },
    })
  })
  it('resolves Workspace and source paths only from the committed registration', async () => {
    const launch = vi.fn(async () => {})
    const operations = createApplicationOperations({ launch })

    const workspace = await operations.execute(
      {
        type: 'launch-action',
        expectedConfigurationVersion: 1,
        actionId: 'open-workspace',
        project: LOCAL.key,
      },
      state(),
    )
    const source = await operations.execute(
      {
        type: 'launch-action',
        expectedConfigurationVersion: 1,
        actionId: 'reveal-source',
        project: LOCAL.key,
      },
      state(),
    )

    expect(workspace).toEqual({
      ok: true,
      result: { type: 'action-launched', actionId: 'open-workspace' },
    })
    expect(source).toEqual({
      ok: true,
      result: { type: 'action-launched', actionId: 'reveal-source' },
    })
    expect(launch.mock.calls).toEqual([
      ['/usr/bin/open', ['-a', 'Visual Studio Code', '/committed/workspace']],
      ['/usr/bin/open', ['-R', '/committed/source']],
    ])
  })

  it('rejects unknown actions without launching a client-controlled value', async () => {
    const launch = vi.fn(async () => {})
    const operations = createApplicationOperations({ launch })

    const result = await operations.execute(
      {
        type: 'launch-action',
        expectedConfigurationVersion: 1,
        actionId: '/bin/sh',
        project: LOCAL.key,
      },
      state(),
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'validation', field: 'actionId' } })
    expect(launch).not.toHaveBeenCalled()
  })
})
