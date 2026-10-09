import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { commandSchema } from '@roadmap/contracts/operations'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubConnectionPort } from '../authorization/contracts.ts'
import {
  type ConfigurationDocument,
  type ConfigurationRead,
  createConfigurationDocument,
} from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type {
  GitHubProjectIntent,
  GitHubProviderRead,
  LocalProjectIntent,
  ProjectAdmission,
  ProjectConfiguration,
  ProjectConfigurationIntent,
} from '../projects/registry.ts'
import {
  fixtureProjectManagement,
  fixtureProjectRef,
  fixtureResourceRef,
  fixtureWorkspacePath,
  readApplicationState,
} from '../public-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const git = promisify(execFile)
const BASE: ProjectConfiguration = {
  schemaVersion: 6,
  configurationVersion: 1,
  connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
  projects: [],
  automation: { enabled: false, enabledProjects: [] },
}

function document(initial: ProjectConfiguration) {
  let current = initial
  const writes: ProjectConfiguration[] = []
  const listeners = new Set<(read: ConfigurationRead) => void>()
  const configuration: ConfigurationDocument = {
    async load() {
      return { ok: true, document: current }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next) {
      current = next
      writes.push(next)
      for (const listener of listeners) listener({ ok: true, document: next })
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {},
  }
  return { configuration, writes }
}

function localIntent(path: string, gitIdentity?: string): LocalProjectIntent {
  return {
    ref: { integration: 'local', projectId: 'stable-local' },
    connectionId: 'local',
    displayName: 'Managed Local',
    workspace: { path, ...(gitIdentity ? { gitIdentity } : {}) },
  }
}

function localApplication(
  initial = BASE,
  admission: ProjectAdmission = createLocalProjectAdmission(),
) {
  const storage = document(initial)
  const observedPaths: string[] = []
  const launch = vi.fn(async () => {})
  const application = createRoadmapApplication({
    configuration: storage.configuration,
    admissions: { local: admission },
    operations: createApplicationOperations({ launch }),
    observers: {
      local(input) {
        observedPaths.push(input.workspace.path)
        return createLocalObserver(input, {
          reconcileMs: 1_000_000,
          logger: { info() {}, warn() {} },
        })
      },
      github() {
        throw new Error('Unexpected GitHub observer')
      },
    },
  })
  return { application, launch, observedPaths, ...storage }
}

function persistedLocalApplication(filename: string) {
  const effects: { executable: string; args: readonly string[] }[] = []
  const application = createRoadmapApplication({
    configuration: createConfigurationDocument(filename, { debounceMs: 60_000 }),
    admissions: { local: createLocalProjectAdmission() },
    operations: createApplicationOperations({
      async launch(executable, args) {
        effects.push({ executable, args: [...args] })
      },
    }),
    observers: {
      local(input) {
        return createLocalObserver(input, {
          reconcileMs: 1_000_000,
          logger: { info() {}, warn() {} },
        })
      },
      github() {
        throw new Error('Unexpected GitHub observer')
      },
    },
  })
  return { application, effects }
}

function registerLocal(application: ReturnType<typeof createRoadmapApplication>, path: string) {
  return application.execute(
    commandSchema.parse({
      type: 'register-project',
      candidate: { integration: 'local', connectionId: 'local', workspace: { path } },
      expectedConfigurationVersion: readApplicationState(application.current())
        .configurationVersion,
    }),
  )
}

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-registration-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function localMap(workspace: string, title: string) {
  const mapDirectory = join(workspace, '.wayfinder', 'registration-map')
  await mkdir(join(mapDirectory, 'tickets'), { recursive: true })
  await writeFile(
    join(mapDirectory, 'map.md'),
    `---\ntitle: ${title}\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\nRead this registered local source.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n`,
    'utf8',
  )
}

async function worktree(path: string, remote = 'Acme/Roadmap') {
  await mkdir(path)
  await git('git', ['-C', path, 'init'])
  await git('git', ['-C', path, 'remote', 'add', 'origin', `https://github.com/${remote}.git`])
}

const github: GitHubConnectionPort = {
  integration: {
    integration: 'github',
    name: 'GitHub',
    connectionKind: 'device-authorization',
    newInstallationUrl: 'https://github.com/apps/roadmap/installations/new',
    installationsUrl: 'https://github.com/settings/installations',
    authorizationsUrl: 'https://github.com/settings/connections/applications/client-id',
  },
  async beginDeviceAuthorization() {
    throw new Error('unexpected authorization')
  },
  async pollDeviceAuthorization() {
    return { status: 'pending' }
  },
  async identify() {
    return { id: '7', login: 'octocat' }
  },
  async refresh() {
    throw new Error('unexpected refresh')
  },
}

function githubApplication(path: string, identityId = '7') {
  const row: GitHubProjectIntent = {
    ref: { integration: 'github', projectId: 'stable-route' },
    connectionId: 'work',
    displayName: 'Managed remote',
    locator: { repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
    workspace: { path },
  }
  const storage = document({
    ...BASE,
    connections: [
      ...BASE.connections,
      {
        id: 'work',
        integration: 'github',
        name: 'Work',
        builtIn: false,
        githubIdentity: { id: '7', login: 'octocat' },
      },
    ],
    projects: [row],
  })
  const requests: string[] = []
  const launch = vi.fn(async () => {})
  let starts = 0
  const client: GitHubProviderRead = {
    async restGet(path) {
      requests.push(path)
      if (path === '/repositories/42') return { id: 42, full_name: 'Acme/Renamed' }
      if (path.startsWith('/repos/Acme/Renamed/issues?')) return [{ number: 108 }]
      if (path === '/repos/Acme/Renamed') return { id: 42, full_name: 'Acme/Renamed' }
      if (path === '/repos/Other/Repository') return { id: 99, full_name: 'Other/Repository' }
      throw new Error(`Unexpected provider request ${path}`)
    },
    async graphql() {
      requests.push('map-read')
      return {
        data: {
          rateLimit: { cost: 1, remaining: 5000, limit: 5000, resetAt: '2027-01-01T00:00:00Z' },
          m0: {
            databaseId: 42,
            nameWithOwner: 'Acme/Renamed',
            issue: {
              number: 108,
              title: 'Remote map',
              url: 'https://github.com/Acme/Renamed/issues/108',
              state: 'OPEN',
              updatedAt: '2026-10-01T00:00:00Z',
              closedAt: null,
              body: '## Destination\n\nKeep remote observation independent of the worktree.\n',
              subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
              subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
            },
          },
        },
        errors: [],
      }
    },
  }
  const pool = createGitHubObserverPool({
    now: () => 1000,
    reconcileMs: 1_000_000,
    logger: { warn() {} },
  })
  const application = createRoadmapApplication({
    configuration: storage.configuration,
    now: () => 1000,
    github: { ...github, identify: async () => ({ id: identityId, login: 'octocat' }) },
    credentialVault: {
      async read() {
        return {
          accessToken: 'authorized-token',
          refreshToken: 'refresh',
          accessTokenExpiresAt: 1_000_000,
          refreshTokenExpiresAt: 2_000_000,
        }
      },
      async write() {},
      async delete() {},
      async cleanupOrphans() {},
    },
    admissions: { github: createGitHubProjectAdmission() },
    providerRead: (accessToken) => ({
      async restGet(path) {
        await accessToken()
        return client.restGet(path)
      },
      async graphql(query, variables) {
        await accessToken()
        return client.graphql(query, variables)
      },
    }),
    operations: createApplicationOperations({ launch }),
    observers: {
      local() {
        throw new Error('Unexpected Local observer')
      },
      github(input) {
        starts += 1
        return pool.create(input)
      },
      reconcileGitHubTopology: (inputs) => pool.reconcileTopology(inputs),
      stop: () => pool.stop(),
    },
  })
  return { application, row, launch, requests, ...storage, starts: () => starts }
}

function repair(
  application: ReturnType<typeof createRoadmapApplication>,
  project: ProjectConfigurationIntent['ref'],
  path: string,
) {
  return application.execute(
    commandSchema.parse({
      type: 'repair-project-workspace',
      project,
      workspace: { path },
      expectedConfigurationVersion: readApplicationState(application.current())
        .configurationVersion,
    }),
  )
}

describe('public application registration authority', () => {
  it.each([
    { basename: ' leading-name', id: 'leading-name' },
    { basename: 'trailing-name ', id: 'trailing-name' },
    { basename: '   ', id: 'local-project' },
  ])(
    'persists and activates normalized Local identity for basename "$basename"',
    async ({ basename, id }) => {
      await fixture(async (root) => {
        const workspace = join(root, basename)
        await localMap(workspace, 'Normalized Local map')
        const canonical = await realpath(workspace)
        const filename = join(root, 'roadmap.config.json')
        await writeFile(filename, `${JSON.stringify(BASE, null, 2)}\n`, 'utf8')
        const { application } = persistedLocalApplication(filename)
        try {
          await application.start()
          expect(await registerLocal(application, workspace)).toMatchObject({
            ok: true,
            result: { type: 'configuration-updated', configurationVersion: 2 },
          })
          expect(JSON.parse(await readFile(filename, 'utf8'))).toEqual({
            ...BASE,
            configurationVersion: 2,
            projects: [
              {
                ref: { integration: 'local', projectId: id },
                connectionId: 'local',
                workspace: { path: canonical },
              },
            ],
          })
          expect(readApplicationState(application.current()).configurationVersion).toBe(2)
          expect(readApplicationState(application.current()).projects).toMatchObject([
            {
              ref: fixtureResourceRef({ integration: 'local', id }),
              connectionId: 'local',
              source: { integration: 'local', path: canonical },
              management: {},
            },
          ])
          expect(readApplicationState(application.current()).projects[0]).toMatchObject({
            ref: fixtureResourceRef({ integration: 'local', id }),
            resource: { kind: 'current-readable' },
          })
          expect(readApplicationState(application.current()).projects[0]).toMatchObject({
            ref: fixtureResourceRef({ integration: 'local', id }),
            maps: [
              expect.objectContaining({
                ref: fixtureResourceRef({
                  project: { integration: 'local', id },
                  mapId: '.wayfinder/registration-map/map.md',
                }),
                resource: {
                  kind: 'current-readable',
                  observation: expect.objectContaining({
                    value: expect.objectContaining({ title: 'Normalized Local map' }),
                  }),
                },
              }),
            ],
          })
        } finally {
          await application.stop()
        }
      })
    },
  )

  it('allocates unique Local IDs when different canonical basenames normalize to the same ID', async () => {
    await fixture(async (root) => {
      const first = join(root, 'shared-name')
      const second = join(root, ' shared-name ')
      await localMap(first, 'First Local map')
      await localMap(second, 'Second Local map')
      const firstCanonical = await realpath(first)
      const secondCanonical = await realpath(second)
      const filename = join(root, 'roadmap.config.json')
      await writeFile(filename, `${JSON.stringify(BASE, null, 2)}\n`, 'utf8')
      const { application } = persistedLocalApplication(filename)
      try {
        await application.start()
        expect((await registerLocal(application, first)).ok).toBe(true)
        expect(await registerLocal(application, second)).toMatchObject({
          ok: true,
          result: { type: 'configuration-updated', configurationVersion: 3 },
        })
        expect(JSON.parse(await readFile(filename, 'utf8'))).toEqual({
          ...BASE,
          configurationVersion: 3,
          projects: [
            {
              ref: { integration: 'local', projectId: 'shared-name' },
              connectionId: 'local',
              workspace: { path: firstCanonical },
            },
            {
              ref: { integration: 'local', projectId: 'shared-name-2' },
              connectionId: 'local',
              workspace: { path: secondCanonical },
            },
          ],
        })
        expect(readApplicationState(application.current()).configurationVersion).toBe(3)
        expect(readApplicationState(application.current()).projects).toMatchObject([
          {
            ref: fixtureResourceRef({ integration: 'local', id: 'shared-name' }),
            connectionId: 'local',
            source: { integration: 'local', path: firstCanonical },
            management: {},
          },
          {
            ref: fixtureResourceRef({ integration: 'local', id: 'shared-name-2' }),
            connectionId: 'local',
            source: { integration: 'local', path: secondCanonical },
            management: {},
          },
        ])
        expect(readApplicationState(application.current()).projects).toEqual([
          expect.objectContaining({
            ref: fixtureResourceRef({ integration: 'local', id: 'shared-name' }),
            resource: expect.objectContaining({ kind: 'current-readable' }),
          }),
          expect.objectContaining({
            ref: fixtureResourceRef({ integration: 'local', id: 'shared-name-2' }),
            resource: expect.objectContaining({ kind: 'current-readable' }),
          }),
        ])
        expect(readApplicationState(application.current()).projects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              ref: fixtureResourceRef({ integration: 'local', id: 'shared-name' }),
              maps: [
                expect.objectContaining({
                  ref: fixtureResourceRef({
                    project: { integration: 'local', id: 'shared-name' },
                    mapId: '.wayfinder/registration-map/map.md',
                  }),
                  resource: {
                    kind: 'current-readable',
                    observation: expect.objectContaining({
                      value: expect.objectContaining({ title: 'First Local map' }),
                    }),
                  },
                }),
              ],
            }),
            expect.objectContaining({
              ref: fixtureResourceRef({ integration: 'local', id: 'shared-name-2' }),
              maps: [
                expect.objectContaining({
                  ref: fixtureResourceRef({
                    project: { integration: 'local', id: 'shared-name-2' },
                    mapId: '.wayfinder/registration-map/map.md',
                  }),
                  resource: {
                    kind: 'current-readable',
                    observation: expect.objectContaining({
                      value: expect.objectContaining({ title: 'Second Local map' }),
                    }),
                  },
                }),
              ],
            }),
          ]),
        )
      } finally {
        await application.stop()
      }
    })
  })

  it('restarts from saved normalized Local identity and reproves its canonical Workspace before host launch', async () => {
    await fixture(async (root) => {
      const workspace = join(root, ' restart-name ')
      const mapDirectory = join(workspace, '.wayfinder', 'saved-map')
      await mkdir(join(mapDirectory, 'tickets'), { recursive: true })
      const mapFilename = join(mapDirectory, 'map.md')
      await writeFile(
        mapFilename,
        '---\ntitle: Before restart\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\nRead this source after restart.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n',
        'utf8',
      )
      const canonical = await realpath(workspace)
      const filename = join(root, 'roadmap.config.json')
      await writeFile(filename, `${JSON.stringify(BASE, null, 2)}\n`, 'utf8')
      const project = {
        integration: 'local',
        projectId: 'restart-name',
      } satisfies ProjectConfigurationIntent['ref']
      const saved = persistedLocalApplication(filename)
      let persistedBytes = ''
      try {
        await saved.application.start()
        expect((await registerLocal(saved.application, workspace)).ok).toBe(true)
        expect(readApplicationState(saved.application.current()).configurationVersion).toBe(2)
        expect(readApplicationState(saved.application.current()).projects[0]?.ref).toEqual(
          fixtureProjectRef(project),
        )
        expect(
          readApplicationState(saved.application.current()).projects[0]?.maps[0]?.resource,
        ).toMatchObject({
          kind: 'current-readable',
          observation: { value: { title: 'Before restart' } },
        })
        persistedBytes = await readFile(filename, 'utf8')
        expect(JSON.parse(persistedBytes)).toEqual({
          ...BASE,
          configurationVersion: 2,
          projects: [
            {
              ref: { integration: 'local', projectId: 'restart-name' },
              connectionId: 'local',
              workspace: { path: canonical },
            },
          ],
        })
        expect(saved.effects).toEqual([])
      } finally {
        await saved.application.stop()
      }
      await writeFile(
        mapFilename,
        '---\ntitle: After restart\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\nRead this source after restart.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n',
        'utf8',
      )
      const restarted = persistedLocalApplication(filename)
      try {
        await restarted.application.start()
        expect(readApplicationState(restarted.application.current()).configurationVersion).toBe(2)
        expect(readApplicationState(restarted.application.current()).projects).toMatchObject([
          {
            ref: fixtureResourceRef(project),
            connectionId: 'local',
            source: { integration: 'local', path: canonical },
            management: {},
          },
        ])
        expect(readApplicationState(restarted.application.current()).projects[0]).toMatchObject({
          ref: fixtureResourceRef(project),
          resource: { kind: 'current-readable' },
        })
        expect(readApplicationState(restarted.application.current()).projects[0]).toMatchObject({
          ref: fixtureResourceRef(project),
          maps: [
            expect.objectContaining({
              ref: fixtureResourceRef({ project, mapId: '.wayfinder/saved-map/map.md' }),
              resource: {
                kind: 'current-readable',
                observation: expect.objectContaining({
                  value: expect.objectContaining({ title: 'After restart' }),
                }),
              },
            }),
          ],
        })
        expect(
          await restarted.application.execute(
            commandSchema.parse({
              type: 'launch-action',
              actionId: 'open-workspace',
              project: fixtureProjectRef(project),
              expectedConfigurationVersion: 2,
            }),
          ),
        ).toMatchObject({
          ok: true,
          result: { type: 'action-launched', actionId: 'open-workspace' },
        })
        expect(restarted.effects).toEqual([
          { executable: '/usr/bin/open', args: ['-a', 'Visual Studio Code', canonical] },
        ])
        expect(readApplicationState(restarted.application.current()).configurationVersion).toBe(2)
        expect(await readFile(filename, 'utf8')).toBe(persistedBytes)
      } finally {
        await restarted.application.stop()
      }
    })
  })

  it('admits a readable non-Git directory and preserves scoped identity through presentation rename', async () => {
    await fixture(async (root) => {
      const test = localApplication()
      await test.application.start()
      try {
        expect(
          (
            await test.application.execute(
              commandSchema.parse({
                type: 'register-project',
                candidate: {
                  integration: 'local',
                  connectionId: 'local',
                  workspace: { path: root },
                  displayName: 'Plain',
                },
                expectedConfigurationVersion: 1,
              }),
            )
          ).ok,
        ).toBe(true)
        const admitted = readApplicationState(test.application.current()).projects[0]
        expect(fixtureWorkspacePath(admitted)).toBe(await realpath(root))
        if (!admitted) throw new Error('missing admitted Project')
        expect(
          (
            await test.application.execute(
              commandSchema.parse({
                type: 'rename-project',
                project: fixtureProjectRef(admitted.ref),
                name: 'Renamed',
                expectedConfigurationVersion: readApplicationState(test.application.current())
                  .configurationVersion,
              }),
            )
          ).ok,
        ).toBe(true)
        expect(readApplicationState(test.application.current()).projects[0]).toMatchObject({
          ref: admitted.ref,
          management: { displayName: 'Renamed' },
        })
      } finally {
        await test.application.stop()
      }
    })
  })

  it.each(['spelling', 'symlink'])(
    'same canonical non-Git %s repair preserves identity',
    async (kind) => {
      await fixture(async (root) => {
        const path = join(root, 'plain')
        await mkdir(path)
        const canonical = await realpath(path)
        const alias = join(root, 'alias')
        await symlink(path, alias, 'dir')
        const test = localApplication({ ...BASE, projects: [localIntent(canonical)] })
        await test.application.start()
        try {
          expect(
            (
              await repair(
                test.application,
                localIntent(canonical).ref,
                kind === 'symlink' ? alias : `${path}/.`,
              )
            ).ok,
          ).toBe(true)
          expect(readApplicationState(test.application.current()).projects[0]).toMatchObject({
            ref: fixtureResourceRef({ integration: 'local', id: 'stable-local' }),
            source: { integration: 'local', path: canonical },
            management: { displayName: 'Managed Local' },
          })
        } finally {
          await test.application.stop()
        }
      })
    },
  )

  it('an unrelated non-Git directory with the same basename cannot inherit scoped identity', async () => {
    await fixture(async (root) => {
      const original = join(root, 'first', 'plain')
      const other = join(root, 'second', 'plain')
      await mkdir(original, { recursive: true })
      await mkdir(other, { recursive: true })
      const row = localIntent(await realpath(original))
      const test = localApplication({ ...BASE, projects: [localIntent(await realpath(original))] })
      await test.application.start()
      try {
        expect((await repair(test.application, row.ref, other)).ok).toBe(false)
        expect(test.writes).toEqual([])
        expect(readApplicationState(test.application.current()).projects).toMatchObject([
          fixtureProjectManagement(row),
        ])
      } finally {
        await test.application.stop()
      }
    })
  })

  it.each(['absent', 'matching', 'different'])(
    'cross-directory Local repair requires recorded matching history: %s',
    async (history) => {
      await fixture(async (root) => {
        const original = join(root, 'original')
        const moved = join(root, 'moved')
        await mkdir(original)
        await git('git', ['-C', original, 'init'])
        await git('git', [
          '-C',
          original,
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          'commit',
          '--allow-empty',
          '-m',
          'Root',
        ])
        await git('git', ['clone', '--local', original, moved])
        const { stdout } = await git('git', ['-C', original, 'rev-parse', 'HEAD'])
        const recorded =
          history === 'absent'
            ? undefined
            : history === 'different'
              ? 'git-roots:unrelated'
              : `git-roots:${stdout.trim()}`
        const row = localIntent(await realpath(original), recorded)
        const test = localApplication({
          ...BASE,
          projects: [localIntent(await realpath(original), recorded)],
        })
        await test.application.start()
        try {
          expect((await repair(test.application, row.ref, moved)).ok).toBe(history === 'matching')
          if (history === 'matching') {
            expect(readApplicationState(test.application.current()).projects[0]).toMatchObject({
              ref: fixtureResourceRef(row.ref),
              source: { integration: 'local', path: await realpath(moved) },
            })
          } else {
            expect(test.writes).toEqual([])
            expect(readApplicationState(test.application.current()).projects).toMatchObject([
              fixtureProjectManagement(row),
            ])
          }
        } finally {
          await test.application.stop()
        }
      })
    },
  )

  it.each(['missing', 'unreadable'])(
    'saved Local %s storage retains management without observer or host authority',
    async (kind) => {
      await fixture(async (root) => {
        const path = join(root, kind)
        if (kind === 'unreadable') await mkdir(path)
        const row = localIntent(path, 'git-roots:recorded')
        const admission =
          kind === 'unreadable'
            ? createLocalProjectAdmission({
                inspectWorkspace: async () => {
                  throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
                },
              })
            : createLocalProjectAdmission()
        const test = localApplication(
          { ...BASE, projects: [localIntent(path, 'git-roots:recorded')] },
          admission,
        )
        await test.application.start()
        try {
          expect(readApplicationState(test.application.current()).projects).toMatchObject([
            fixtureProjectManagement(row),
          ])
          expect(readApplicationState(test.application.current()).projects[0]).toMatchObject({
            ref: fixtureResourceRef(row.ref),
            name: 'Managed Local',
            resource: { kind: 'never-observed' },
          })
          expect(test.observedPaths).toEqual([])
          expect(
            await test.application.execute(
              commandSchema.parse({
                type: 'launch-action',
                actionId: 'open-workspace',
                project: fixtureProjectRef(row.ref),
                expectedConfigurationVersion: readApplicationState(test.application.current())
                  .configurationVersion,
              }),
            ),
          ).toMatchObject({
            ok: false,
            error: { code: 'admission-failed', field: 'workspace.path' },
          })
          expect(test.launch).not.toHaveBeenCalled()
        } finally {
          await test.application.stop()
        }
      })
    },
  )

  it('observes authorized saved GitHub source with missing worktree but fails host launch closed', async () => {
    await fixture(async (root) => {
      const test = githubApplication(join(root, 'missing'))
      const publications: ReadyApplicationState[] = []
      test.application.subscribe((state) => publications.push(readApplicationState(state)))
      await test.application.start()
      try {
        expect(readApplicationState(test.application.current()).projects).toMatchObject([
          fixtureProjectManagement(test.row),
        ])
        expect(readApplicationState(test.application.current()).projects[0]).toMatchObject({
          ref: fixtureResourceRef(test.row.ref),
          name: 'Managed remote',
          resource: { kind: 'current-readable', observation: { observedAt: 1000 } },
        })
        expect(readApplicationState(test.application.current()).projects[0]?.activeMap).toEqual({
          kind: 'known-current',
          ref: { project: { integration: 'github', projectId: 'stable-route' }, mapId: '108' },
        })
        expect(
          publications.some((state) => state.projects[0]?.resource.kind === 'current-readable'),
        ).toBe(true)
        expect(test.requests.filter((path) => path === '/repositories/42')).toHaveLength(1)
        expect(test.requests.filter((path) => path === 'map-read')).toHaveLength(1)
        expect(
          await test.application.execute(
            commandSchema.parse({
              type: 'launch-action',
              actionId: 'open-terminal',
              project: fixtureProjectRef(test.row.ref),
              expectedConfigurationVersion: readApplicationState(test.application.current())
                .configurationVersion,
            }),
          ),
        ).toMatchObject({
          ok: false,
          error: { code: 'admission-failed', field: 'workspace.path' },
        })
        expect(test.launch).not.toHaveBeenCalled()
      } finally {
        await test.application.stop()
      }
    })
  })

  it('same GitHub repository repair updates renamed locator without replacing remote evidence', async () => {
    await fixture(async (root) => {
      const test = githubApplication(join(root, 'missing'))
      const moved = join(root, 'moved')
      await worktree(moved, 'Acme/Renamed')
      await test.application.start()
      try {
        const before = readApplicationState(test.application.current()).projects[0]
        const evidence = before && {
          resource: before.resource,
          mapsMembership: before.mapsMembership,
          maps: before.maps,
          activeMap: before.activeMap,
          displayOrder: before.displayOrder,
        }
        const requests = [...test.requests]
        const starts = test.starts()
        expect((await repair(test.application, test.row.ref, moved)).ok).toBe(true)
        expect(readApplicationState(test.application.current()).projects[0]).toMatchObject({
          ref: fixtureResourceRef(test.row.ref),
          connectionId: 'work',
          source: { repositoryId: '42', nameWithOwner: 'Acme/Renamed' },
          management: { workspacePath: await realpath(moved) },
        })
        const after = readApplicationState(test.application.current()).projects[0]
        expect(
          after && {
            resource: after.resource,
            mapsMembership: after.mapsMembership,
            maps: after.maps,
            activeMap: after.activeMap,
            displayOrder: after.displayOrder,
          },
        ).toEqual(evidence)
        expect(test.starts()).toBe(starts)
        expect(test.requests.filter((path) => path === '/repositories/42')).toEqual(
          requests.filter((path) => path === '/repositories/42'),
        )
        expect(test.requests.filter((path) => path === 'map-read')).toHaveLength(1)
      } finally {
        await test.application.stop()
      }
    })
  })

  it('another GitHub repository repair cannot rebind configured identity', async () => {
    await fixture(async (root) => {
      const test = githubApplication(join(root, 'missing'))
      const other = join(root, 'other')
      await worktree(other, 'Other/Repository')
      await test.application.start()
      try {
        expect((await repair(test.application, test.row.ref, other)).ok).toBe(false)
        expect(test.writes).toEqual([])
        expect(readApplicationState(test.application.current()).projects).toMatchObject([
          fixtureProjectManagement(test.row),
        ])
      } finally {
        await test.application.stop()
      }
    })
  })

  it('a live token for a mismatched GitHub account grants no provider or repair authority', async () => {
    await fixture(async (root) => {
      const test = githubApplication(join(root, 'missing'), 'different-account')
      const moved = join(root, 'moved')
      await worktree(moved, 'Acme/Renamed')
      await test.application.start()
      try {
        expect(readApplicationState(test.application.current()).projects).toMatchObject([
          fixtureProjectManagement(test.row),
        ])
        expect(readApplicationState(test.application.current()).projects[0]?.resource.kind).toBe(
          'never-observed',
        )
        expect(test.requests).toEqual([])
        expect((await repair(test.application, test.row.ref, moved)).ok).toBe(false)
        expect(test.writes).toEqual([])
      } finally {
        await test.application.stop()
      }
    })
  })
})
