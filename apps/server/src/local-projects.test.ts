import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readLocalProjectRegistry } from './local-projects.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('readLocalProjectRegistry', () => {
  it('treats a missing registry as empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-local-projects-'))
    roots.push(root)

    const result = await readLocalProjectRegistry(join(root, 'missing.json'))
    expect(result).toEqual({ registrations: [], warnings: [] })
  })

  it('keeps a missing root registered and warns that it should surface as unreachable', async () => {
    const path = await writeRegistry(`[
      {"path":"/tmp/roadmap-missing-root","id":"missing-root"}
    ]`)

    const result = await readLocalProjectRegistry(path)
    expect(result.registrations).toEqual([
      {
        id: 'missing-root',
        rootPath: '/tmp/roadmap-missing-root',
        rootExists: false,
      },
    ])
    expect(result.warnings).toEqual([
      'Registered path "/tmp/roadmap-missing-root" does not exist right now; it stays registered and should surface as unreachable.',
    ])
  })

  it('warns and returns nothing on invalid json', async () => {
    const path = await writeRegistry('{ nope')
    const result = await readLocalProjectRegistry(path)
    expect(result.registrations).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Could not parse')
  })

  it('warns and returns nothing when the top level is not an array', async () => {
    const path = await writeRegistry('{"path":"/tmp/demo","id":"demo"}')
    const result = await readLocalProjectRegistry(path)
    expect(result).toEqual({
      registrations: [],
      warnings: [`${path} must contain a JSON array of registrations.`],
    })
  })

  it('expands home paths, rejects relative ones, and keeps the first duplicate path or id', async () => {
    const path = await writeRegistry(`[
      {"path":"~/demo/../project","id":"demo","displayName":"Demo"},
      {"path":"~/project","id":"second"},
      {"path":"/tmp/elsewhere","id":"demo"},
      {"path":"relative/project","id":"relative"},
      {"path":"~other/project","id":"bad-home"},
      {"path":"/tmp/kept","id":"kept"}
    ]`)

    const result = await readLocalProjectRegistry(path)
    expect(result.registrations).toEqual([
      {
        id: 'demo',
        rootPath: resolve(homedir(), 'project'),
        rootExists: false,
        displayName: 'Demo',
      },
      {
        id: 'kept',
        rootPath: '/tmp/kept',
        rootExists: false,
      },
    ])
    expect(result.warnings).toEqual([
      `Registered path ${JSON.stringify(resolve(homedir(), 'project'))} does not exist right now; it stays registered and should surface as unreachable.`,
      `Ignored ${path}[1]: path ${JSON.stringify(resolve(homedir(), 'project'))} duplicates ${path}[0].`,
      `Ignored ${path}[2]: id ${JSON.stringify('demo')} duplicates ${path}[0].`,
      `Ignored ${path}[3]: path ${JSON.stringify('relative/project')} is relative; use ~/... or an absolute path.`,
      `Ignored ${path}[4]: path ${JSON.stringify('~other/project')} uses unsupported home shorthand; use ~/... or an absolute path.`,
      'Registered path "/tmp/kept" does not exist right now; it stays registered and should surface as unreachable.',
    ])
  })

  it('ignores malformed registrations field by field', async () => {
    const path = await writeRegistry(`[
      1,
      {"path":"/tmp/ok","id":"ok","displayName":99},
      {"path":"/tmp/no-id"},
      {"path":[],"id":"bad-path"},
      {"path":"/tmp/blank","id":"   "},
      {"path":"/tmp/blank-name","id":"blank-name","displayName":"   "}
    ]`)

    const result = await readLocalProjectRegistry(path)
    expect(result.registrations).toEqual([
      { id: 'ok', rootPath: '/tmp/ok', rootExists: false },
      { id: 'blank-name', rootPath: '/tmp/blank-name', rootExists: false },
    ])
    expect(result.warnings).toEqual([
      `Ignored ${path}[0]: expected an object registration.`,
      `${path}[1]: displayName must be a string when present; ignoring that field.`,
      'Registered path "/tmp/ok" does not exist right now; it stays registered and should surface as unreachable.',
      `Ignored ${path}[2]: id must be a string.`,
      `Ignored ${path}[3]: path must be a string.`,
      `Ignored ${path}[4]: id must not be empty.`,
      `${path}[5]: displayName must not be empty when present; ignoring that field.`,
      'Registered path "/tmp/blank-name" does not exist right now; it stays registered and should surface as unreachable.',
    ])
  })
})

async function writeRegistry(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-local-projects-'))
  roots.push(root)
  const path = join(root, 'local-projects.json')
  await writeFile(path, content)
  return path
}
