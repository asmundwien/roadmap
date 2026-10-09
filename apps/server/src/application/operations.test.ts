import type { ProjectKey } from '@roadmap/contracts'
import { describe, expect, it, vi } from 'vitest'
import { refineLocalWorkspaceProof, type WorkspaceAdmission } from '../projects/registry.ts'
import {
  createApplicationOperations,
  type OperationCommand,
  type OperationContext,
} from './operations.ts'

const PROJECT: ProjectKey = { integration: 'local', id: 'demo' }

function admitted(path = '/current/workspace'): WorkspaceAdmission {
  const proof = refineLocalWorkspaceProof({
    inspection: {
      integration: 'local',
      path,
      readable: true,
      searchable: true,
    },
  })
  if (!proof.ok) throw new Error(proof.error.message)
  return { status: 'admitted', proof: proof.value }
}

function context(workspace: WorkspaceAdmission | undefined = admitted()): OperationContext {
  return {
    async refresh() {
      return true
    },
    async workspace(project) {
      return project.integration === PROJECT.integration && project.id === PROJECT.id
        ? workspace
        : undefined
    },
    workspaceAdmissionError() {
      return null
    },
  }
}

describe('createApplicationOperations', () => {
  it('returns a native folder selection and treats cancellation as no selection', async () => {
    const selectWorkspace = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('/selected/workspace/')
      .mockResolvedValueOnce(null)
    const operations = createApplicationOperations({ selectWorkspace })

    await expect(operations.query({ type: 'select-workspace' })).resolves.toEqual({
      ok: true,
      type: 'workspace-selection',
      path: '/selected/workspace',
    })
    await expect(operations.query({ type: 'select-workspace' })).resolves.toEqual({
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

    await expect(operations.query({ type: 'select-workspace' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'selection-failed',
        message: 'The folder selector could not be opened.',
      },
    })
  })

  it('resolves every host action through current private Workspace proof', async () => {
    const launch = vi.fn(async () => {})
    const operations = createApplicationOperations({ launch })
    let workspace = admitted('/first/workspace')
    const current: OperationContext = {
      ...context(),
      async workspace() {
        return workspace
      },
    }

    for (const actionId of ['open-workspace', 'open-terminal', 'reveal-source']) {
      workspace = admitted(`/current/${actionId}`)
      expect(
        await operations.execute(
          {
            type: 'launch-action',
            expectedConfigurationVersion: 1,
            actionId,
            project: PROJECT,
          },
          current,
        ),
      ).toEqual({ ok: true, result: { type: 'action-launched', actionId } })
    }

    expect(launch.mock.calls).toEqual([
      ['/usr/bin/open', ['-a', 'Visual Studio Code', '/current/open-workspace']],
      ['/usr/bin/open', ['-a', 'Terminal', '/current/open-terminal']],
      ['/usr/bin/open', ['-R', '/current/reveal-source']],
    ])
  })

  it.each<WorkspaceAdmission>([
    { status: 'unverified' },
    {
      status: 'unavailable',
      error: {
        code: 'admission-failed',
        field: 'workspace.path',
        message: 'Workspace is no longer readable.',
      },
    },
  ])('refuses host effects without admitted Workspace proof: $status', async (workspace) => {
    const launch = vi.fn(async () => {})
    const operations = createApplicationOperations({ launch })

    expect(
      await operations.execute(
        {
          type: 'launch-action',
          expectedConfigurationVersion: 1,
          actionId: 'open-workspace',
          project: PROJECT,
        },
        context(workspace),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'admission-failed', field: 'workspace.path' },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it('refreshes the selected active source through the application context', async () => {
    const refresh = vi
      .fn<OperationContext['refresh']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const operations = createApplicationOperations()
    const current = { ...context(), refresh }
    const command: OperationCommand = {
      type: 'refresh-project',
      expectedConfigurationVersion: 1,
      project: PROJECT,
    }

    expect(await operations.execute(command, current)).toEqual({
      ok: true,
      result: { type: 'project-refreshed', project: PROJECT },
    })
    expect(await operations.execute(command, current)).toMatchObject({
      ok: false,
      error: { code: 'validation', field: 'project' },
    })
    expect(refresh.mock.calls).toEqual([[PROJECT], [PROJECT]])
  })

  it('rejects unknown actions without launching a client-controlled value', async () => {
    const launch = vi.fn(async () => {})
    const operations = createApplicationOperations({ launch })

    const result = await operations.execute(
      {
        type: 'launch-action',
        expectedConfigurationVersion: 1,
        actionId: '/bin/sh',
        project: PROJECT,
      },
      context(),
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'validation', field: 'actionId' } })
    expect(launch).not.toHaveBeenCalled()
  })
})
