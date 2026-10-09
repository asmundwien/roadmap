import * as filesystem from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConfigurationDocument,
  decodeConfigurationDocument,
} from '../configuration/document.ts'
import type { ConfiguredConnection, ProjectConfiguration } from '../projects/registry.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) }
})

type WriteFailure =
  | 'open'
  | 'write'
  | 'file-sync'
  | 'file-close'
  | 'rename'
  | 'directory-open'
  | 'directory-sync'
  | 'directory-close'

async function failWriteAt(step: WriteFailure, directory: string): Promise<void> {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  if (step === 'rename') {
    vi.mocked(filesystem.rename).mockRejectedValueOnce(new Error('controlled rename failure'))
    return
  }
  vi.mocked(filesystem.open).mockImplementation(async (path, flags, mode) => {
    const isDirectory = path === directory
    if ((step === 'open' && flags === 'wx') || (step === 'directory-open' && isDirectory)) {
      throw new Error('controlled open failure')
    }
    const handle = await actual.open(path, flags, mode)
    if (!isDirectory && step === 'write')
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('controlled write failure'))
    if ((!isDirectory && step === 'file-sync') || (isDirectory && step === 'directory-sync')) {
      vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('controlled sync failure'))
    }
    if (!isDirectory && step === 'file-close')
      vi.spyOn(handle, 'close').mockRejectedValueOnce(new Error('controlled close failure'))
    if (isDirectory && step === 'directory-close') {
      const close = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
        await close()
        throw new Error('controlled close failure after sync')
      })
    }
    return handle
  })
}

const roots: string[] = []
const LOCAL_CONNECTION: ConfiguredConnection = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}

async function temporaryPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-configuration-'))
  roots.push(root)
  return join(root, 'roadmap.config.json')
}

afterEach(async () => {
  vi.restoreAllMocks()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open)
  vi.mocked(filesystem.rename).mockReset().mockImplementation(actual.rename)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('roadmap configuration', () => {
  it('creates and reads the versioned empty document atomically on first use', async () => {
    const path = await temporaryPath()
    const document = createConfigurationDocument(path)

    const result = await document.load()

    expect(result).toEqual({
      ok: true,
      durability: 'confirmed',
      document: {
        schemaVersion: 6,
        configurationVersion: 1,
        connections: [LOCAL_CONNECTION],
        projects: [],
        automation: { enabled: false, enabledProjects: [] },
      },
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(
      result.ok ? result.document : undefined,
    )
    await document.stop()
  })

  it('reports an invalid manual save and recovers when a higher semantic version is valid', async () => {
    const path = await temporaryPath()
    const document = createConfigurationDocument(path, { debounceMs: 5 })
    await document.load()
    const changes = vi.fn()
    document.subscribe(changes)

    await writeFile(path, '{ invalid', 'utf8')
    await vi.waitFor(() => expect(changes).toHaveBeenCalled())
    expect(changes.mock.calls.at(-1)?.[0]).toMatchObject({ ok: false })

    const repaired: ProjectConfiguration = {
      schemaVersion: 6,
      configurationVersion: 2,
      connections: [LOCAL_CONNECTION],
      projects: [],
      automation: { enabled: false, enabledProjects: [] },
    }
    await writeFile(path, `${JSON.stringify(repaired, null, 2)}\n`, 'utf8')
    await vi.waitFor(() =>
      expect(changes.mock.calls.at(-1)?.[0]).toEqual({ ok: true, document: repaired }),
    )
    await document.stop()
  })

  it('detects an external-edit race before replacing the whole document', async () => {
    const path = await temporaryPath()
    const document = createConfigurationDocument(path, { debounceMs: 1_000 })
    const loaded = await document.load()
    expect(loaded.ok).toBe(true)

    await writeFile(path, '{"external":true}\n', 'utf8')
    const result = await document.write({
      schemaVersion: 6,
      configurationVersion: 2,
      connections: [LOCAL_CONNECTION],
      projects: [],
      automation: { enabled: false, enabledProjects: [] },
    })

    expect(result).toMatchObject({ ok: false, kind: 'conflict' })
    expect(await readFile(path, 'utf8')).toBe('{"external":true}\n')
    await document.stop()
  })

  it.each(['open', 'write', 'file-sync', 'file-close', 'rename'] satisfies WriteFailure[])(
    'retains original bytes and publishes no replacement after a precommit %s failure',
    async (step) => {
      const path = await temporaryPath()
      const document = createConfigurationDocument(path, { debounceMs: 60_000 })
      try {
        const loaded = await document.load()
        if (!loaded.ok) throw new Error('Expected valid initial configuration')
        const original = await readFile(path, 'utf8')
        const changes: unknown[] = []
        document.subscribe((read) => changes.push(read))
        const next = { ...loaded.document, configurationVersion: 2 }
        await failWriteAt(step, dirname(path))

        expect(await document.write(next)).toMatchObject({ ok: false, kind: 'persistence' })
        expect(await readFile(path, 'utf8')).toBe(original)
        expect(changes).toEqual([])

        vi.restoreAllMocks()
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        vi.mocked(filesystem.open).mockImplementation(actual.open)
        expect(await document.write(next)).toMatchObject({ ok: true })
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(next)
      } finally {
        await document.stop()
      }
    },
  )

  it.each(['directory-open', 'directory-sync', 'directory-close'] satisfies WriteFailure[])(
    'retains committed bytes and document truth after a %s failure',
    async (step) => {
      const path = await temporaryPath()
      const document = createConfigurationDocument(path, { debounceMs: 60_000 })
      try {
        const loaded = await document.load()
        if (!loaded.ok) throw new Error('Expected valid initial configuration')
        const changes: unknown[] = []
        document.subscribe((read) => changes.push(read))
        const next = { ...loaded.document, configurationVersion: 2 }
        await failWriteAt(step, dirname(path))

        const outcome = await document.write(next)
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(next)
        expect(changes).toEqual([
          {
            ok: true,
            document: next,
            durability: step === 'directory-close' ? 'confirmed' : 'unconfirmed',
            ...(step === 'directory-close'
              ? {}
              : {
                  message:
                    'Configuration was replaced, but filesystem durability could not be confirmed.',
                }),
          },
        ])
        expect(outcome).toMatchObject({
          ok: true,
          durability: step === 'directory-close' ? 'confirmed' : 'unconfirmed',
        })

        vi.restoreAllMocks()
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        vi.mocked(filesystem.open).mockImplementation(actual.open)
        const following = { ...next, configurationVersion: 3 }
        expect(await document.write(following)).toMatchObject({ ok: true })
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(following)
        expect(changes.at(-1)).toEqual({ ok: true, document: following, durability: 'confirmed' })
      } finally {
        await document.stop()
      }
    },
  )

  it('serializes concurrent replacements against the latest committed bytes', async () => {
    const path = await temporaryPath()
    const document = createConfigurationDocument(path, { debounceMs: 60_000 })
    try {
      const loaded = await document.load()
      if (!loaded.ok) throw new Error('Expected valid initial configuration')
      const second = { ...loaded.document, configurationVersion: 2 }
      const third = { ...loaded.document, configurationVersion: 3 }
      const changes: unknown[] = []
      document.subscribe((read) => changes.push(read))

      const outcomes = await Promise.all([document.write(second), document.write(third)])

      expect(outcomes).toEqual([
        { ok: true, durability: 'confirmed' },
        { ok: true, durability: 'confirmed' },
      ])
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(third)
      expect(changes).toEqual([
        { ok: true, document: second, durability: 'confirmed' },
        { ok: true, document: third, durability: 'confirmed' },
      ])
    } finally {
      await document.stop()
    }
  })

  it('rejects secret-looking fields and inconsistent registration references', () => {
    const decoded = decodeConfigurationDocument({
      schemaVersion: 6,
      configurationVersion: 1,
      accessToken: 'never',
      connections: [LOCAL_CONNECTION],
      projects: [
        {
          ref: { integration: 'local', projectId: 'demo' },
          connectionId: 'missing',
          workspace: { path: '/tmp/demo' },
        },
      ],
      automation: { enabled: false, enabledProjects: [] },
    })

    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.issues).toEqual(
      expect.arrayContaining([
        { path: '$.accessToken', message: 'Secrets are not allowed.' },
        { path: '$.accessToken', message: 'Unknown field.' },
        {
          path: '$.projects[0].connectionId',
          message: 'Must name an existing Connection.',
        },
      ]),
    )
  })

  it('requires durable GitHub identity metadata and rejects duplicate users', () => {
    const decoded = decodeConfigurationDocument({
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [
        LOCAL_CONNECTION,
        {
          id: 'first',
          integration: 'github',
          name: 'First',
          builtIn: false,
          githubIdentity: { id: '42', login: 'octocat' },
        },
        {
          id: 'second',
          integration: 'github',
          name: 'Second',
          builtIn: false,
          githubIdentity: { id: '42', login: 'renamed-octocat' },
        },
      ],
      projects: [],
      automation: { enabled: false, enabledProjects: [] },
    })

    expect(decoded).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          path: '$.connections[2].githubIdentity.id',
          message: 'That GitHub user already has a Connection.',
        }),
      ],
    })
  })
  it('rejects duplicate stable GitHub repository identities', () => {
    const decoded = decodeConfigurationDocument({
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [
        LOCAL_CONNECTION,
        {
          id: 'github',
          integration: 'github',
          name: 'GitHub',
          builtIn: false,
          githubIdentity: { id: '7', login: 'octocat' },
        },
      ],
      projects: [
        {
          ref: { integration: 'github', projectId: 'acme/one' },
          connectionId: 'github',
          locator: { repositoryId: '42', nameWithOwner: 'acme/one' },
          workspace: { path: '/one' },
        },
        {
          ref: { integration: 'github', projectId: 'acme/two' },
          connectionId: 'github',
          locator: { repositoryId: '42', nameWithOwner: 'acme/two' },
          workspace: { path: '/two' },
        },
      ],
      automation: { enabled: false, enabledProjects: [] },
    })

    expect(decoded).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          path: '$.projects[1].locator.repositoryId',
          message: 'That GitHub repository is already registered.',
        }),
      ],
    })
  })

  it('rejects obsolete registration fields and keeps Connection and Workspace fields integration-specific', () => {
    const local = {
      ref: { integration: 'local', projectId: 'local-project' },
      connectionId: 'local',
      workspace: { path: '/tmp/local-project', gitIdentity: 'git@github.com:acme/local.git' },
    }
    const github = {
      ref: { integration: 'github', projectId: 'github-project' },
      connectionId: 'github',
      locator: { repositoryId: '42', nameWithOwner: 'acme/remote' },
      workspace: { path: '/tmp/remote-project' },
    }
    const configuration = {
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [
        LOCAL_CONNECTION,
        {
          id: 'github',
          integration: 'github',
          name: 'GitHub',
          builtIn: false,
          githubIdentity: { id: '7', login: 'octocat' },
        },
      ],
      projects: [local, github],
      automation: { enabled: false, enabledProjects: [] },
    }
    expect(decodeConfigurationDocument(configuration)).toMatchObject({ ok: true })

    for (const [project, path] of [
      [{ ...local, key: { integration: 'local', id: 'local-project' } }, '$.projects[0].key'],
      [
        { ...local, locator: { integration: 'local', path: local.workspace.path } },
        '$.projects[0].locator',
      ],
      [
        { ...local, workspace: { ...local.workspace, readable: true } },
        '$.projects[0].workspace.readable',
      ],
      [
        { ...github, locator: { ...github.locator, integration: 'github' } },
        '$.projects[0].locator.integration',
      ],
      [
        { ...github, workspace: { ...github.workspace, gitIdentity: 'acme/remote' } },
        '$.projects[0].workspace.gitIdentity',
      ],
    ] satisfies readonly (readonly [unknown, string])[]) {
      expect(decodeConfigurationDocument({ ...configuration, projects: [project] })).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([{ path, message: 'Unknown field.' }]),
      })
    }

    expect(
      decodeConfigurationDocument({
        ...configuration,
        connections: [{ ...LOCAL_CONNECTION, githubIdentity: { id: '7', login: 'octocat' } }],
        projects: [local],
      }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { path: '$.connections[0].githubIdentity', message: 'Unknown field.' },
      ]),
    })
  })

  it('accepts literal Harness Commands and rejects shell-shaped or unregistered configuration', () => {
    const project = {
      ref: { integration: 'local' as const, projectId: 'demo' },
      connectionId: 'local',
      workspace: { path: '/tmp/demo' },
    }
    expect(
      decodeConfigurationDocument({
        schemaVersion: 6,
        configurationVersion: 1,
        connections: [LOCAL_CONNECTION],
        projects: [project],
        automation: {
          enabled: true,
          classificationCommand: {
            command: '/usr/bin/agent',
            args: ['run', '{{roadmap.prompt}}'],
            promptDelivery: 'argument',
            promptTemplate:
              'Map {{roadmap.map}} ticket {{roadmap.ticket}} schema {{roadmap.classificationResultSchema}}',
          },
          wayfinderCommand: {
            command: '/usr/bin/agent',
            args: [],
            promptDelivery: 'stdin',
            promptTemplate: '/skill:wayfinder {{roadmap.ticket}} {{roadmap.sessionReportSchema}}',
          },
          enabledProjects: [{ integration: project.ref.integration, id: project.ref.projectId }],
        },
      }),
    ).toMatchObject({ ok: true })

    const invalid = decodeConfigurationDocument({
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [LOCAL_CONNECTION],
      projects: [project],
      automation: {
        enabled: true,
        classificationCommand: {
          command: '/bin/sh\0-c',
          args: ['{{roadmap.prompt}}', '{{roadmap.prompt}}'],
          promptDelivery: 'argument',
          shell: true,
          promptTemplate: '{{roadmap.ticket}} {{roadmap.ticket}} {{roadmap.unknown}}',
        },
        wayfinderCommand: {
          command: '/usr/bin/agent',
          args: [],
          promptDelivery: 'stdin',
          promptTemplate:
            'Map {{roadmap.map}} ticket {{roadmap.ticket}} schema {{roadmap.classificationResultSchema}}',
        },
        enabledProjects: [{ integration: 'local', id: 'missing' }],
      },
    })
    expect(invalid).toMatchObject({ ok: false })
    if (invalid.ok) return
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '$.automation.classificationCommand.shell' }),
        expect.objectContaining({ path: '$.automation.classificationCommand.command' }),
        expect.objectContaining({ path: '$.automation.classificationCommand.args' }),
        expect.objectContaining({
          path: '$.automation.classificationCommand.promptTemplate',
        }),
        expect.objectContaining({
          path: '$.automation.wayfinderCommand.promptTemplate',
          message: expect.stringContaining('Unknown template marker'),
        }),
        expect.objectContaining({ path: '$.automation.enabledProjects[0]' }),
      ]),
    )
  })
  it('migrates version two configuration to inert Automation without replaying the Registry', async () => {
    const path = await temporaryPath()
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 2,
        configurationVersion: 7,
        connections: [LOCAL_CONNECTION],
        projects: [],
      })}\n`,
      'utf8',
    )
    const document = createConfigurationDocument(path)

    const result = await document.load()

    expect(result).toEqual({
      ok: true,
      durability: 'confirmed',
      document: {
        schemaVersion: 6,
        configurationVersion: 8,
        connections: [LOCAL_CONNECTION],
        projects: [],
        automation: { enabled: false, enabledProjects: [] },
      },
    })
    await document.stop()
  })

  it('migrates version three commands but resets Classification-only enablement', async () => {
    const path = await temporaryPath()
    const project = {
      key: { integration: 'local' as const, id: 'demo' },
      connectionId: 'local',
      locator: { integration: 'local' as const, path: '/tmp/demo' },
      workspace: { path: '/tmp/demo' },
    }
    const command = {
      command: '/usr/bin/agent',
      args: ['run', '{{roadmap.prompt}}'],
      promptDelivery: 'argument' as const,
    }
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 3,
        configurationVersion: 9,
        connections: [LOCAL_CONNECTION],
        projects: [project],
        classification: { command, enabledProjects: [project.key] },
      })}\n`,
      'utf8',
    )

    const document = createConfigurationDocument(path)
    const result = await document.load()

    expect(result).toEqual({
      ok: true,
      durability: 'confirmed',
      document: {
        schemaVersion: 6,
        configurationVersion: 10,
        connections: [LOCAL_CONNECTION],
        projects: [
          {
            ref: { integration: 'local', projectId: 'demo' },
            connectionId: 'local',
            workspace: { path: '/tmp/demo' },
          },
        ],
        automation: {
          enabled: false,
          classificationCommand: {
            ...command,
            promptTemplate: expect.stringContaining('{{roadmap.classificationResultSchema}}'),
          },
          enabledProjects: [],
        },
      },
    })
    await document.stop()
  })

  it('materializes built-in prompts when migrating version four Automation', async () => {
    const path = await temporaryPath()
    const project = {
      key: { integration: 'local' as const, id: 'demo' },
      connectionId: 'local',
      locator: { integration: 'local' as const, path: '/tmp/demo' },
      workspace: { path: '/tmp/demo' },
    }
    const classificationCommand = {
      command: '/usr/bin/agent',
      args: ['run', '{{roadmap.prompt}}'],
      promptDelivery: 'argument' as const,
    }
    const wayfinderCommand = {
      command: '/usr/bin/agent',
      args: [],
      promptDelivery: 'stdin' as const,
    }
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 4,
        configurationVersion: 11,
        connections: [LOCAL_CONNECTION],
        projects: [project],
        automation: {
          enabled: true,
          classificationCommand,
          wayfinderCommand,
          enabledProjects: [project.key],
        },
      })}\n`,
      'utf8',
    )

    const document = createConfigurationDocument(path)
    const result = await document.load()

    expect(result).toMatchObject({
      ok: true,
      durability: 'confirmed',
      document: {
        schemaVersion: 6,
        configurationVersion: 12,
        connections: [LOCAL_CONNECTION],
        projects: [
          {
            ref: { integration: 'local', projectId: 'demo' },
            connectionId: 'local',
            workspace: { path: '/tmp/demo' },
          },
        ],
        automation: {
          enabled: true,
          classificationCommand: {
            ...classificationCommand,
            promptTemplate: expect.stringContaining('{{roadmap.classificationResultSchema}}'),
          },
          wayfinderCommand: {
            ...wayfinderCommand,
            promptTemplate: expect.stringContaining('{{roadmap.sessionReportSchema}}'),
          },
          enabledProjects: [project.key],
        },
      },
    })
    await document.stop()
  })

  it('migrates version five registrations to private intents without changing identities or Automation preferences', async () => {
    const path = await temporaryPath()
    const connections: ConfiguredConnection[] = [
      LOCAL_CONNECTION,
      {
        id: 'github',
        integration: 'github',
        name: 'GitHub',
        builtIn: false,
        githubIdentity: { id: '7', login: 'octocat' },
      },
    ]
    const command = {
      command: '/usr/bin/agent',
      args: [],
      promptDelivery: 'stdin' as const,
      promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
    }
    const automation = {
      enabled: true,
      classificationCommand: command,
      wayfinderCommand: command,
      enabledProjects: [
        { integration: 'local' as const, id: 'retained-local' },
        { integration: 'github' as const, id: 'retained-github' },
      ],
    }
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 5,
        configurationVersion: 21,
        connections,
        projects: [
          {
            key: { integration: 'local', id: 'retained-local' },
            connectionId: 'local',
            displayName: 'Local name',
            locator: { integration: 'local', path: '/tmp/local-project' },
            workspace: { path: '/tmp/local-project', gitIdentity: 'git@github.com:acme/local.git' },
          },
          {
            key: { integration: 'github', id: 'retained-github' },
            connectionId: 'github',
            displayName: 'Remote name',
            locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'acme/remote' },
            workspace: { path: '/tmp/remote-project' },
          },
        ],
        automation,
      })}\n`,
      'utf8',
    )
    const document = createConfigurationDocument(path)
    try {
      const expected: ProjectConfiguration = {
        schemaVersion: 6,
        configurationVersion: 22,
        connections,
        projects: [
          {
            ref: { integration: 'local', projectId: 'retained-local' },
            connectionId: 'local',
            displayName: 'Local name',
            workspace: { path: '/tmp/local-project', gitIdentity: 'git@github.com:acme/local.git' },
          },
          {
            ref: { integration: 'github', projectId: 'retained-github' },
            connectionId: 'github',
            displayName: 'Remote name',
            locator: { repositoryId: '42', nameWithOwner: 'acme/remote' },
            workspace: { path: '/tmp/remote-project' },
          },
        ],
        automation,
      }
      expect(await document.load()).toEqual({
        ok: true,
        document: expected,
        durability: 'confirmed',
      })
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(expected)
    } finally {
      await document.stop()
    }
  })

  it('imports valid legacy Local registrations once and reports malformed or missing entries', async () => {
    const path = await temporaryPath()
    const root = dirname(path)
    const existing = join(root, 'existing')
    const missing = join(root, 'missing')
    const registryPath = join(root, 'local-projects.json')
    await mkdir(existing)
    const canonicalExisting = await realpath(existing)
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        configurationVersion: 0,
        connections: [],
        projects: [],
      })}\n`,
      'utf8',
    )
    await writeFile(
      registryPath,
      JSON.stringify([
        { id: 'kept-route', path: existing, displayName: 'Kept name' },
        { id: 'missing-route', path: missing },
        { path: existing },
      ]),
      'utf8',
    )

    const document = createConfigurationDocument(path)
    const migrated = await document.load()

    expect(migrated).toMatchObject({
      ok: true,
      durability: 'confirmed',
      document: {
        schemaVersion: 6,
        configurationVersion: 1,
        connections: [LOCAL_CONNECTION],
        projects: [
          {
            ref: { integration: 'local', projectId: 'kept-route' },
            connectionId: 'local',
            workspace: { path: canonicalExisting },
            displayName: 'Kept name',
          },
          {
            ref: { integration: 'local', projectId: 'missing-route' },
            connectionId: 'local',
            workspace: { path: missing },
          },
        ],
        automation: { enabled: false, enabledProjects: [] },
      },
      notices: expect.arrayContaining([
        expect.stringContaining('does not exist right now'),
        expect.stringContaining('id must be a string'),
      ]),
    })
    await document.stop()

    await writeFile(registryPath, JSON.stringify([{ id: 'late', path: existing }]), 'utf8')
    const reloaded = createConfigurationDocument(path)
    const current = await reloaded.load()
    expect(current.ok && current.document.projects.map((project) => project.ref.projectId)).toEqual(
      ['kept-route', 'missing-route'],
    )
    await reloaded.stop()
  })
})
