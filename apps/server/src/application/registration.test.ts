import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ApplicationState, ProjectRegistration } from '@roadmap/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import type { GitHubConnectionPort } from '../github/connections.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type {
  GitHubProviderRead,
  LocalProjectIntent,
  ProjectAdmission,
  ProjectConfiguration,
} from '../projects/registry.ts'
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

function localRow(path: string, gitIdentity?: string): ProjectRegistration {
  return {
    key: { integration: 'local', id: 'stable-local' },
    connectionId: 'local',
    displayName: 'Managed Local',
    locator: { integration: 'local', path },
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

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-registration-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
  const row: ProjectRegistration = {
    key: { integration: 'github', id: 'stable-route' },
    connectionId: 'work',
    displayName: 'Managed remote',
    locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
    workspace: { path, gitIdentity: '42' },
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
    projects: [
      {
        ref: { integration: 'github', projectId: 'stable-route' },
        connectionId: 'work',
        displayName: 'Managed remote',
        locator: { repositoryId: '42', nameWithOwner: 'Acme/Roadmap' },
        workspace: { path },
      },
    ],
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
  project: ProjectRegistration['key'],
  path: string,
) {
  return application.execute({
    type: 'repair-project-workspace',
    project,
    workspace: { path },
    expectedConfigurationVersion: application.current().configurationVersion,
  })
}

describe('public application registration authority', () => {
  it('admits a readable non-Git directory and preserves scoped identity through presentation rename', async () => {
    await fixture(async (root) => {
      const test = localApplication()
      await test.application.start()
      try {
        expect(
          (
            await test.application.execute({
              type: 'register-project',
              candidate: {
                integration: 'local',
                connectionId: 'local',
                workspace: { path: root },
                displayName: 'Plain',
              },
              expectedConfigurationVersion: 1,
            })
          ).ok,
        ).toBe(true)
        const admitted = test.application.current().registrations[0]
        expect(admitted?.workspace.path).toBe(await realpath(root))
        expect(admitted?.workspace.gitIdentity).toBeUndefined()
        if (!admitted) throw new Error('missing admitted Project')
        expect(
          (
            await test.application.execute({
              type: 'rename-project',
              project: admitted.key,
              name: 'Renamed',
              expectedConfigurationVersion: test.application.current().configurationVersion,
            })
          ).ok,
        ).toBe(true)
        expect(test.application.current().registrations[0]).toMatchObject({
          key: admitted.key,
          displayName: 'Renamed',
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
                localRow(canonical).key,
                kind === 'symlink' ? alias : `${path}/.`,
              )
            ).ok,
          ).toBe(true)
          expect(test.application.current().registrations[0]).toMatchObject({
            key: { integration: 'local', id: 'stable-local' },
            workspace: { path: canonical },
            displayName: 'Managed Local',
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
      const row = localRow(await realpath(original))
      const test = localApplication({ ...BASE, projects: [localIntent(await realpath(original))] })
      await test.application.start()
      try {
        expect((await repair(test.application, row.key, other)).ok).toBe(false)
        expect(test.writes).toEqual([])
        expect(test.application.current().registrations).toEqual([row])
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
        const row = localRow(await realpath(original), recorded)
        const test = localApplication({
          ...BASE,
          projects: [localIntent(await realpath(original), recorded)],
        })
        await test.application.start()
        try {
          expect((await repair(test.application, row.key, moved)).ok).toBe(history === 'matching')
          if (history === 'matching') {
            expect(test.application.current().registrations[0]).toMatchObject({
              key: row.key,
              workspace: { path: await realpath(moved), gitIdentity: recorded },
            })
          } else {
            expect(test.writes).toEqual([])
            expect(test.application.current().registrations).toEqual([row])
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
        const row = localRow(path, 'git-roots:recorded')
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
          expect(test.application.current().registrations).toEqual([row])
          expect(test.application.current().projects[0]).toMatchObject({
            key: row.key,
            name: 'Managed Local',
            availability: { status: 'unavailable' },
          })
          expect(test.observedPaths).toEqual([])
          expect(
            await test.application.execute({
              type: 'launch-action',
              actionId: 'open-workspace',
              project: row.key,
              expectedConfigurationVersion: test.application.current().configurationVersion,
            }),
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
      const publications: ApplicationState[] = []
      test.application.subscribe((state) => publications.push(state))
      await test.application.start()
      try {
        expect(test.application.current().registrations).toEqual([test.row])
        expect(test.application.current().projects[0]).toMatchObject({
          key: test.row.key,
          name: 'Managed remote',
          availability: { status: 'available', observedAt: 1000 },
        })
        expect(test.application.current().roadmap.projects[0]?.openMaps[0]?.id).toBe('108')
        expect(
          publications.some((state) => state.projects[0]?.availability.status === 'available'),
        ).toBe(true)
        expect(test.requests.filter((path) => path === '/repositories/42')).toHaveLength(1)
        expect(test.requests.filter((path) => path === 'map-read')).toHaveLength(1)
        expect(
          await test.application.execute({
            type: 'launch-action',
            actionId: 'open-terminal',
            project: test.row.key,
            expectedConfigurationVersion: test.application.current().configurationVersion,
          }),
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
        const before = test.application.current().projects[0]
        const evidence = test.application.current().roadmap.projects
        const requests = [...test.requests]
        const starts = test.starts()
        expect((await repair(test.application, test.row.key, moved)).ok).toBe(true)
        expect(test.application.current().registrations[0]).toMatchObject({
          key: test.row.key,
          connectionId: 'work',
          locator: { repositoryId: '42', nameWithOwner: 'Acme/Renamed' },
          workspace: { path: await realpath(moved) },
        })
        expect(test.application.current().projects[0]?.availability.observedAt).toBe(
          before?.availability.observedAt,
        )
        expect(test.application.current().roadmap.projects).toEqual(evidence)
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
        expect((await repair(test.application, test.row.key, other)).ok).toBe(false)
        expect(test.writes).toEqual([])
        expect(test.application.current().registrations).toEqual([test.row])
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
        expect(test.application.current().registrations).toEqual([test.row])
        expect(test.application.current().projects[0]?.availability.status).toBe('unavailable')
        expect(test.requests).toEqual([])
        expect((await repair(test.application, test.row.key, moved)).ok).toBe(false)
        expect(test.writes).toEqual([])
      } finally {
        await test.application.stop()
      }
    })
  })
})
