import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ProjectKey } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { createConfigurationDocument } from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import type { CredentialBundle, GitHubConnectionPort } from '../github/connections.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import { createRoadmapApplication } from './application.ts'
import type { CredentialVault } from './credential-vault.ts'
import { createApplicationOperations } from './operations.ts'

const git = promisify(execFile)
const A = { integration: 'github', id: 'a' } satisfies ProjectKey
const B = { integration: 'github', id: 'b' } satisfies ProjectKey
const REPOSITORIES = [
  { id: 42, nameWithOwner: 'Acme/Roadmap', mapId: 108, title: 'Repository A map' },
  { id: 99, nameWithOwner: 'Other/Repository', mapId: 109, title: 'Repository B map' },
]

type DeniedWorkspace = 'repository-mismatch' | 'authorization-unavailable'

async function occupancyFixture(
  denied: DeniedWorkspace,
  run: (fixture: {
    application: ReturnType<typeof createRoadmapApplication>
    effects: Array<{ executable: string; args: readonly string[] }>
    workspace: string
    alias: string
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-github-occupancy-'))
  let application: ReturnType<typeof createRoadmapApplication> | undefined
  try {
    const workspace = join(root, 'worktree')
    const alias = join(root, 'alias')
    await mkdir(workspace)
    await git('git', ['-C', workspace, 'init'])
    await git('git', [
      '-C',
      workspace,
      'remote',
      'add',
      'origin',
      'https://github.com/Acme/Roadmap.git',
    ])
    await symlink(workspace, alias)

    const unauthorized = {
      id: 'unauthorized',
      integration: 'github',
      name: 'Unauthorized',
      builtIn: false,
      githubIdentity: { id: '8', login: 'other-account' },
    } satisfies ProjectConfiguration['connections'][number]
    const initial: ProjectConfiguration = {
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [
        { id: 'local', integration: 'local', name: 'Local', builtIn: true },
        {
          id: 'authorized',
          integration: 'github',
          name: 'Authorized',
          builtIn: false,
          githubIdentity: { id: '7', login: 'octocat' },
        },
        ...(denied === 'authorization-unavailable' ? [unauthorized] : []),
      ],
      projects: [
        {
          ref: { integration: 'github', projectId: 'a' },
          connectionId: 'authorized',
          locator: { repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
          workspace: { path: workspace },
        },
        {
          ref: { integration: 'github', projectId: 'b' },
          connectionId: denied === 'authorization-unavailable' ? 'unauthorized' : 'authorized',
          locator: { repositoryId: '99', nameWithOwner: 'Other/Repository' },
          workspace: { path: alias },
        },
      ],
      automation: { enabled: false, enabledProjects: [] },
    }
    const filename = join(root, 'roadmap.config.json')
    await writeFile(filename, JSON.stringify(initial))
    const credentials: CredentialBundle = {
      accessToken: 'occupancy-test-access-token',
      refreshToken: 'occupancy-test-refresh-token',
      accessTokenExpiresAt: 1_000_000,
      refreshTokenExpiresAt: 2_000_000,
    }
    const records = new Map<string, CredentialBundle>([['authorized', credentials]])
    const vault: CredentialVault = {
      async read(id) {
        return records.get(id) ?? null
      },
      async write(id, value) {
        records.set(id, value)
      },
      async delete(id) {
        records.delete(id)
      },
      async cleanupOrphans(ids) {
        for (const id of records.keys()) if (!ids.has(id)) records.delete(id)
      },
    }
    const github: GitHubConnectionPort = {
      integration: {
        integration: 'github',
        name: 'GitHub',
        connectionKind: 'device-authorization',
        newInstallationUrl: 'https://github.com/apps/roadmap/installations/new',
        installationsUrl: 'https://github.com/settings/installations',
        authorizationsUrl: 'https://github.com/settings/connections/applications/test',
      },
      async identify(token) {
        if (token !== credentials.accessToken) throw new Error('Unexpected account credential.')
        return { id: '7', login: 'octocat' }
      },
      async refresh() {
        throw new Error('The fixture credential is not expired.')
      },
      async beginDeviceAuthorization() {
        throw new Error('This fixture does not authorize accounts.')
      },
      async pollDeviceAuthorization() {
        throw new Error('This fixture does not authorize accounts.')
      },
    }
    const pool = createGitHubObserverPool({
      now: () => 1000,
      reconcileMs: 1_000_000,
      logger: { warn() {} },
    })
    const effects: Array<{ executable: string; args: readonly string[] }> = []
    application = createRoadmapApplication({
      configuration: createConfigurationDocument(filename),
      now: () => 1000,
      github,
      credentialVault: vault,
      admissions: { github: createGitHubProjectAdmission() },
      providerRead(accessToken) {
        async function authorize() {
          if ((await accessToken()) !== credentials.accessToken)
            throw new Error('Provider received an unexpected Connection credential.')
        }
        return {
          async restGet(path) {
            await authorize()
            for (const repository of REPOSITORIES) {
              if (
                path === `/repositories/${repository.id}` ||
                path === `/repos/${repository.nameWithOwner}`
              )
                return { id: repository.id, full_name: repository.nameWithOwner }
              if (
                path ===
                `/repos/${repository.nameWithOwner}/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1`
              )
                return [{ number: repository.mapId }]
            }
            throw new Error(`Unexpected provider path ${path}`)
          },
          async graphql(_query, variables) {
            await authorize()
            const repository = REPOSITORIES.find(
              (entry) =>
                entry.nameWithOwner === `${variables?.o0}/${variables?.n0}` &&
                entry.mapId === variables?.i0,
            )
            if (!repository) throw new Error('Map request must name an admitted repository.')
            return {
              data: {
                rateLimit: {
                  cost: 1,
                  remaining: 5000,
                  limit: 5000,
                  resetAt: '2027-01-01T00:00:00Z',
                },
                m0: {
                  databaseId: repository.id,
                  nameWithOwner: repository.nameWithOwner,
                  issue: {
                    number: repository.mapId,
                    title: repository.title,
                    url: `https://github.com/${repository.nameWithOwner}/issues/${repository.mapId}`,
                    state: 'OPEN',
                    updatedAt: '2026-10-01T00:00:00Z',
                    closedAt: null,
                    body: '## Destination\n\nObserve remote source independently of Workspace proof.\n',
                    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
                    subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
                  },
                },
              },
              errors: [],
            }
          },
        }
      },
      operations: createApplicationOperations({
        async launch(executable, args) {
          effects.push({ executable, args: [...args] })
        },
        async selectWorkspace() {
          throw new Error('This fixture does not open a folder selector.')
        },
      }),
      observers: {
        local() {
          throw new Error('Unexpected Local observer.')
        },
        github: (input) => pool.create(input),
        reconcileGitHubTopology: (inputs) => pool.reconcileTopology(inputs),
        stop: () => pool.stop(),
      },
    })
    await application.start()
    await run({ application, effects, workspace, alias })
  } finally {
    try {
      await application?.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
}

function openWorkspace(
  application: ReturnType<typeof createRoadmapApplication>,
  project: ProjectKey,
) {
  return application.execute({
    type: 'launch-action',
    actionId: 'open-workspace',
    project,
    expectedConfigurationVersion: application.current().configurationVersion,
  })
}

describe('RoadmapApplication GitHub canonical Workspace occupancy', () => {
  it('denies A host authority when repository-mismatched B occupies its canonical worktree without losing B remote source', async () => {
    await occupancyFixture(
      'repository-mismatch',
      async ({ application, effects, workspace, alias }) => {
        expect(await realpath(alias)).toBe(await realpath(workspace))
        expect(alias).not.toBe(workspace)
        expect(application.current().configuration.valid).toBe(true)
        expect(application.current().registrations).toHaveLength(2)
        expect(
          application.current().projects.find((project) => project.key.id === 'a'),
        ).toMatchObject({
          key: A,
          availability: { status: 'available', observedAt: 1000 },
          openMaps: [expect.objectContaining({ id: '108', title: 'Repository A map' })],
        })
        expect(
          application.current().projects.find((project) => project.key.id === 'b'),
        ).toMatchObject({
          key: B,
          availability: { status: 'available', observedAt: 1000 },
          openMaps: [
            expect.objectContaining({
              id: '109',
              title: 'Repository B map',
              url: 'https://github.com/Other/Repository/issues/109',
            }),
          ],
        })
        expect(
          application.current().roadmap.projects.find((project) => project.key.id === 'b'),
        ).toMatchObject({
          key: B,
          sourceUrl: 'https://github.com/Other/Repository',
          openMaps: [expect.objectContaining({ id: '109', title: 'Repository B map' })],
        })
        const b = application.current().projects.find((project) => project.key.id === 'b')
        expect(b?.warnings).toContainEqual(expect.stringMatching(/Workspace.*remotes.*repository/))
        expect(b?.actions.filter((action) => action.kind === 'server-launch')).toEqual([])
        expect(b?.actions).toContainEqual(
          expect.objectContaining({
            id: 'open-source',
            kind: 'external-link',
            href: 'https://github.com/Other/Repository',
          }),
        )
        expect(
          await application.execute({
            type: 'refresh-project',
            project: B,
            expectedConfigurationVersion: application.current().configurationVersion,
          }),
        ).toMatchObject({ ok: true, result: { type: 'project-refreshed', project: B } })
        expect(await openWorkspace(application, B)).toMatchObject({
          ok: false,
          error: { code: 'admission-failed', field: 'workspace.path' },
        })
        const outcome = await openWorkspace(application, A)
        expect.soft(outcome).toMatchObject({
          ok: false,
          error: { code: 'admission-failed', field: 'workspace.path' },
        })
        expect(effects).toEqual([])
        expect(
          application.current().projects.find((project) => project.key.id === 'b')?.availability,
        ).toMatchObject({
          status: 'available',
          observedAt: 1000,
        })
      },
    )
  })

  it('denies A host authority when unauthorized B on a separate Connection occupies its canonical worktree', async () => {
    await occupancyFixture(
      'authorization-unavailable',
      async ({ application, effects, workspace, alias }) => {
        expect(await realpath(alias)).toBe(await realpath(workspace))
        expect(alias).not.toBe(workspace)
        const state = application.current()
        expect(state.configuration.valid).toBe(true)
        expect(state.registrations).toHaveLength(2)
        expect(
          state.connections.find((connection) => connection.id === 'authorized'),
        ).toMatchObject({
          availability: { status: 'available', observedAt: 1000 },
        })
        expect(
          state.connections.find((connection) => connection.id === 'unauthorized'),
        ).toMatchObject({
          availability: { status: 'authorization-required' },
        })
        expect(state.projects.find((project) => project.key.id === 'a')).toMatchObject({
          key: A,
          connectionId: 'authorized',
          availability: { status: 'available', observedAt: 1000 },
          openMaps: [expect.objectContaining({ id: '108', title: 'Repository A map' })],
        })
        const b = state.projects.find((project) => project.key.id === 'b')
        expect(b).toMatchObject({
          key: B,
          connectionId: 'unauthorized',
          locator: { integration: 'github', repositoryId: '99' },
          availability: { status: 'unavailable' },
          openMaps: [],
          closedMaps: [],
        })
        expect(b?.availability.observedAt).toBeUndefined()
        expect(b?.actions.filter((action) => action.kind === 'server-launch')).toEqual([])
        expect(state.roadmap.projects.some((project) => project.key.id === 'b')).toBe(false)
        expect(
          await application.execute({
            type: 'refresh-project',
            project: B,
            expectedConfigurationVersion: application.current().configurationVersion,
          }),
        ).toMatchObject({ ok: false })
        expect(await openWorkspace(application, B)).toMatchObject({
          ok: false,
          error: { code: 'admission-failed', field: 'workspace.path' },
        })
        const outcome = await openWorkspace(application, A)
        expect.soft(outcome).toMatchObject({
          ok: false,
          error: { code: 'admission-failed', field: 'workspace.path' },
        })
        expect(effects).toEqual([])
        expect(
          application.current().connections.find((connection) => connection.id === 'authorized'),
        ).toMatchObject({
          availability: { status: 'available', observedAt: 1000 },
        })
        expect(
          application.current().projects.find((project) => project.key.id === 'b')?.availability,
        ).toMatchObject({
          status: 'unavailable',
        })
      },
    )
  })
})
