import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConfigurationDocument,
  type RoadmapConfiguration,
  roadmapConfigurationCodec,
} from './configuration.ts'

const roots: string[] = []
const LOCAL_CONNECTION: RoadmapConfiguration['connections'][number] = {
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
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('roadmap configuration', () => {
  it('creates and reads the versioned empty document atomically on first use', async () => {
    const path = await temporaryPath()
    const document = createConfigurationDocument(path)

    const result = await document.load()

    expect(result).toEqual({
      ok: true,
      document: {
        schemaVersion: 5,
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

    const repaired: RoadmapConfiguration = {
      schemaVersion: 5,
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
      schemaVersion: 5,
      configurationVersion: 2,
      connections: [LOCAL_CONNECTION],
      projects: [],
      automation: { enabled: false, enabledProjects: [] },
    })

    expect(result).toMatchObject({ ok: false, kind: 'conflict' })
    expect(await readFile(path, 'utf8')).toBe('{"external":true}\n')
    await document.stop()
  })

  it('rejects secret-looking fields and inconsistent registration references', () => {
    const decoded = roadmapConfigurationCodec.decode({
      schemaVersion: 5,
      configurationVersion: 1,
      accessToken: 'never',
      connections: [LOCAL_CONNECTION],
      projects: [
        {
          key: { integration: 'local', id: 'demo' },
          connectionId: 'missing',
          locator: { integration: 'local', path: '/tmp/demo' },
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
    const decoded = roadmapConfigurationCodec.decode({
      schemaVersion: 5,
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
    const decoded = roadmapConfigurationCodec.decode({
      schemaVersion: 5,
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
          key: { integration: 'github', id: 'acme/one' },
          connectionId: 'github',
          locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'acme/one' },
          workspace: { path: '/one' },
        },
        {
          key: { integration: 'github', id: 'acme/two' },
          connectionId: 'github',
          locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'acme/two' },
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

  it('accepts literal Harness Commands and rejects shell-shaped or unregistered configuration', () => {
    const project = {
      key: { integration: 'local' as const, id: 'demo' },
      connectionId: 'local',
      locator: { integration: 'local' as const, path: '/tmp/demo' },
      workspace: { path: '/tmp/demo' },
    }
    expect(
      roadmapConfigurationCodec.decode({
        schemaVersion: 5,
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
            promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
          },
          enabledProjects: [project.key],
        },
      }),
    ).toMatchObject({ ok: true })

    const invalid = roadmapConfigurationCodec.decode({
      schemaVersion: 5,
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
      document: {
        schemaVersion: 5,
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
      document: {
        schemaVersion: 5,
        configurationVersion: 10,
        connections: [LOCAL_CONNECTION],
        projects: [project],
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
      document: {
        schemaVersion: 5,
        configurationVersion: 12,
        automation: {
          enabled: true,
          classificationCommand: {
            ...classificationCommand,
            promptTemplate: expect.stringContaining('{{roadmap.classificationResultSchema}}'),
          },
          wayfinderCommand: {
            ...wayfinderCommand,
            promptTemplate: expect.stringContaining('{{roadmap.ticket}}'),
          },
          enabledProjects: [project.key],
        },
      },
    })
    await document.stop()
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
      document: {
        schemaVersion: 5,
        configurationVersion: 1,
        connections: [LOCAL_CONNECTION],
        projects: [
          {
            key: { integration: 'local', id: 'kept-route' },
            connectionId: 'local',
            locator: { integration: 'local', path: canonicalExisting },
            workspace: { path: canonicalExisting },
            displayName: 'Kept name',
          },
          {
            key: { integration: 'local', id: 'missing-route' },
            connectionId: 'local',
            locator: { integration: 'local', path: missing },
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
    expect(current.ok && current.document.projects.map((project) => project.key.id)).toEqual([
      'kept-route',
      'missing-route',
    ])
    await reloaded.stop()
  })
})
