import * as filesystem from 'node:fs/promises'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AutomationDatabase,
  type AutomationEvent,
  appendAutomationDatabase,
  createAutomationDatabaseDocument,
  decodeAutomationDatabase,
  replayAutomationDatabase,
} from '../automation/database.ts'
import { createConfigurationDocument } from '../configuration/document.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import type { SourceContribution } from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import {
  createSourceFixtureOwner,
  type FixtureProject,
  type FixtureTicket,
} from '../source-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) }
})

const roots: string[] = []
const target = {
  project: { integration: 'local' as const, id: 'project' },
  mapId: 'map',
  ticketId: 'ticket',
}
const opportunity = { id: 'opportunity', target }
const RECORDED_AT = '2026-08-29T00:00:00.000Z'

afterEach(async () => {
  vi.restoreAllMocks()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open)
  vi.mocked(filesystem.rename).mockReset().mockImplementation(actual.rename)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function identity(id: string, opportunityId = opportunity.id) {
  return { id, opportunityId, recordedAt: RECORDED_AT }
}

function started(
  id = 'classification-started',
): Extract<AutomationEvent, { type: 'classification-started' }> {
  return { ...identity(id), type: 'classification-started', admission: 'automatic' }
}

function completed(
  verdict: 'afk' | 'hitl' | 'unable' = 'afk',
): Extract<AutomationEvent, { type: 'classification-completed' }> {
  return {
    ...identity('classification-completed'),
    type: 'classification-completed',
    processResult: { status: 'exited', code: 0 },
    verdict: { value: verdict, reason: `${verdict} verdict` },
  }
}

function database(events: readonly AutomationEvent[]): AutomationDatabase {
  return { schemaVersion: 3, opportunities: [opportunity], events }
}

describe('Automation event database', () => {
  it('strictly decodes only schema version 3 and exact event variants', () => {
    const valid = database([started()])
    expect(decodeAutomationDatabase(valid)).toEqual(valid)

    for (const invalid of [
      { ...valid, extra: true },
      { ...valid, events: [{ ...started(), extra: true }] },
      { ...valid, events: [{ ...started(), recordedAt: 'yesterday' }] },
      { ...valid, events: [{ ...started(), admission: 'manual' }] },
    ]) {
      expect(() => decodeAutomationDatabase(invalid)).toThrow()
    }
  })

  it('replays sequence into evidence and retains causal acknowledgement metadata', () => {
    const unknown = {
      ...identity('unknown'),
      type: 'wayfinder-outcome-unknown' as const,
      reason: 'Roadmap restarted.',
    }
    const value = database([
      started(),
      completed(),
      { ...identity('launching'), type: 'wayfinder-launching', admission: 'override' },
      { ...identity('running'), type: 'wayfinder-running' },
      unknown,
      {
        ...identity('acknowledged'),
        type: 'wayfinder-outcome-unknown-acknowledged',
        unknownEventId: unknown.id,
      },
    ])

    const projection = replayAutomationDatabase(value)

    expect(projection.records[0]).toMatchObject({
      opportunity,
      classification: {
        status: 'completed',
        admission: 'automatic',
        verdict: { value: 'afk' },
      },
      wayfinder: {
        status: 'outcome-unknown',
        admission: 'override',
        eventId: unknown.id,
        acknowledged: true,
      },
    })
    expect(projection.evidence[0]?.wayfinder).toEqual({
      status: 'outcome-unknown',
      admission: 'override',
      reason: 'Roadmap restarted.',
      acknowledged: true,
    })
  })

  it('publishes a queued Session after an AFK verdict', () => {
    const projection = replayAutomationDatabase(database([started(), completed()]))

    expect(projection.records[0]?.wayfinder).toEqual({ status: 'queued' })
    expect(projection.evidence[0]?.wayfinder).toEqual({ status: 'queued' })
  })

  it.each([
    ['orphan event', { schemaVersion: 3, opportunities: [], events: [started()] }],
    [
      'duplicate target',
      {
        schemaVersion: 3,
        opportunities: [opportunity, { id: 'other-opportunity', target }],
        events: [started(), started('other-start')],
      },
    ],
    [
      'Wayfinder before AFK',
      database([
        started(),
        completed('hitl'),
        { ...identity('launching'), type: 'wayfinder-launching', admission: 'automatic' },
      ]),
    ],
    ['repeated terminal event', database([started(), completed(), completed()])],
    [
      'wrong acknowledgement reference',
      database([
        started(),
        completed(),
        { ...identity('launching'), type: 'wayfinder-launching', admission: 'automatic' },
        { ...identity('unknown'), type: 'wayfinder-outcome-unknown', reason: 'Unknown.' },
        {
          ...identity('acknowledged'),
          type: 'wayfinder-outcome-unknown-acknowledged',
          unknownEventId: 'different-event',
        },
      ]),
    ],
  ])('rejects the invalid %s history', (_name, invalid) => {
    expect(() => decodeAutomationDatabase(invalid)).toThrow()
  })

  it('appends durable facts atomically without replacing prior history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-automation-database-'))
    roots.push(root)
    const path = join(root, 'automation.json')
    const document = createAutomationDatabaseDocument(path)

    expect(await document.load()).toEqual({ schemaVersion: 3, opportunities: [], events: [] })
    expect(await document.append({ opportunities: [opportunity], events: [started()] })).toEqual({
      database: database([started()]),
      durability: 'confirmed',
    })
    expect(await document.append({ events: [completed()] })).toEqual({
      database: database([started(), completed()]),
      durability: 'confirmed',
    })

    const stored: unknown = JSON.parse(await readFile(path, 'utf8'))
    expect(stored).toEqual(database([started(), completed()]))
    expect(await createAutomationDatabaseDocument(path).load()).toEqual(stored)

    await expect(
      document.append({
        events: [{ ...identity('invalid-running'), type: 'wayfinder-running' }],
      }),
    ).rejects.toThrow('invalid at this point in history')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(stored)
  })

  it.each(['directory-open', 'directory-sync', 'directory-close'] as const)(
    'retains replayable committed history with honest durability after %s failure',
    async (failure) => {
      const root = await mkdtemp(join(tmpdir(), 'roadmap-automation-database-'))
      roots.push(root)
      const path = join(root, 'automation.json')
      const document = createAutomationDatabaseDocument(path)
      await document.load()
      await document.append({ opportunities: [opportunity], events: [started()] })
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      vi.mocked(filesystem.open).mockImplementation(async (file, flags, mode) => {
        if (file === root && failure === 'directory-open')
          throw new Error('controlled directory open failure')
        const handle = await actual.open(file, flags, mode)
        if (file === root && failure === 'directory-sync') {
          vi.spyOn(handle, 'sync').mockRejectedValueOnce(
            new Error('controlled directory sync failure'),
          )
        }
        if (file === root && failure === 'directory-close') {
          const close = handle.close.bind(handle)
          vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
            await close()
            throw new Error('controlled directory close failure after sync')
          })
        }
        return handle
      })

      const outcome = await document.append({ events: [completed()] })
      const stored: unknown = JSON.parse(await readFile(path, 'utf8'))
      expect(stored).toEqual(database([started(), completed()]))
      expect(await createAutomationDatabaseDocument(path).load()).toEqual(stored)
      expect(replayAutomationDatabase(decodeAutomationDatabase(stored)).evidence[0]).toMatchObject({
        classification: { status: 'completed', verdict: { value: 'afk' } },
        wayfinder: { status: 'queued' },
      })
      expect(outcome).toMatchObject({
        database: stored,
        durability: failure === 'directory-close' ? 'confirmed' : 'unconfirmed',
      })

      vi.restoreAllMocks()
      vi.mocked(filesystem.open).mockImplementation(actual.open)
      await document.append({
        events: [
          {
            ...identity('wayfinder-launching'),
            type: 'wayfinder-launching',
            admission: 'automatic',
          },
        ],
      })
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        events: [started(), completed(), expect.objectContaining({ type: 'wayfinder-launching' })],
      })
    },
  )

  it('retains prior history after a true precommit rename failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-automation-database-'))
    roots.push(root)
    const path = join(root, 'automation.json')
    const document = createAutomationDatabaseDocument(path)
    await document.load()
    await document.append({ opportunities: [opportunity], events: [started()] })
    const original = await readFile(path, 'utf8')
    vi.mocked(filesystem.rename).mockRejectedValueOnce(new Error('controlled rename failure'))

    await expect(document.append({ events: [completed()] })).rejects.toThrow()

    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await createAutomationDatabaseDocument(path).load()).toEqual(database([started()]))
    await document.append({ events: [completed()] })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(database([started(), completed()]))
  })

  it('keeps committed admission history but launches nothing when directory durability is unconfirmed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-durability-admission-'))
    roots.push(root)
    const workspace = await realpath(root)
    const sourceTarget = { ...target, mapId: '.wayfinder/map.md' }
    const candidate: FixtureTicket = {
      id: 'ticket',
      displayId: 'ticket',
      title: 'Resolve the route',
      body: 'Resolve the route.',
      typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
      state: 'frontier',
      isClaimed: false,
      isBlocked: false,
      assignees: [],
      blockedBy: [],
      blockersComplete: true,
      warnings: [],
      sourcePath: join(workspace, '.wayfinder/tickets/ticket.md'),
    }
    const source: FixtureProject = {
      key: target.project,
      name: 'Project',
      closedMaps: [],
      warnings: [],
      sourcePath: workspace,
      openMaps: [
        {
          project: target.project,
          id: sourceTarget.mapId,
          title: 'Map',
          isOpen: true,
          updatedAt: 1,
          body: {
            raw: '',
            destination: 'Reach the destination',
            notes: [],
            decisions: [],
            notYetSpecified: [],
            notYetSpecifiedNote: '',
            outOfScope: [],
            sections: [],
            missingSections: [],
          },
          tickets: [candidate],
          frontier: [candidate],
          progress: { total: 1, completed: 0 },
          ticketsComplete: true,
          warnings: [],
          sourcePath: join(workspace, '.wayfinder/map.md'),
        },
      ],
    }
    const command = {
      command: process.execPath,
      args: ['-e', 'process.stdin.resume()'],
      promptDelivery: 'stdin' as const,
      promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
    }
    const configuration: ProjectConfiguration = {
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
      projects: [
        {
          ref: { integration: 'local', projectId: target.project.id },
          connectionId: 'local',
          workspace: { path: workspace },
        },
      ],
      automation: {
        enabled: false,
        enabledProjects: [],
        classificationCommand: command,
        wayfinderCommand: command,
      },
    }
    const configurationPath = join(root, 'roadmap.config.json')
    const databasePath = join(root, 'automation.json')
    await writeFile(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`, 'utf8')
    const effects: string[] = []
    const application = createRoadmapApplication({
      configuration: createConfigurationDocument(configurationPath, { debounceMs: 60_000 }),
      automation: {
        database: createAutomationDatabaseDocument(databasePath),
        launcher: {
          classify() {
            effects.push('classification')
            throw new Error('Launcher must not be invoked')
          },
          async dispatch() {
            effects.push('wayfinder')
            throw new Error('Launcher must not be invoked')
          },
        },
      },
      admissions: { local: createLocalProjectAdmission() },
      observers: {
        local(input) {
          const read = createSourceFixtureOwner()
          const contribution: SourceContribution = {
            project: { integration: input.ref.integration, id: input.ref.projectId },
            attempts: read([source], 100).attempts,
            health: { status: 'available', observedAt: 100 },
          }
          return {
            async observe() {
              return contribution
            },
            async refresh() {
              return contribution
            },
            subscribe() {
              return () => {}
            },
            async stop() {},
          }
        },
        github() {
          throw new Error('Unexpected GitHub observer')
        },
      },
    })
    try {
      await application.start()
      expect(application.current().automation.overrides).toContainEqual(
        expect.objectContaining({ target: sourceTarget, classification: { status: 'eligible' } }),
      )
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      vi.mocked(filesystem.open).mockImplementation(async (file, flags, mode) => {
        const handle = await actual.open(file, flags, mode)
        if (file === root)
          vi.spyOn(handle, 'sync').mockRejectedValueOnce(
            new Error('controlled directory durability uncertainty'),
          )
        return handle
      })

      const outcome = await application.execute({
        type: 'start-automation-override',
        expectedConfigurationVersion: 1,
        target: sourceTarget,
        stage: 'classification',
      })

      expect(outcome).toMatchObject({ ok: false, error: { code: 'persistence-failed' } })
      expect(effects).toEqual([])
      const stored = await createAutomationDatabaseDocument(databasePath).load()
      expect(stored.events.map((event) => event.type)).toEqual(['classification-started'])
      expect(replayAutomationDatabase(stored).evidence[0]).toMatchObject({
        target: sourceTarget,
        classification: { status: 'running', admission: 'override' },
      })
      expect(application.current().automation.evidence[0]).toMatchObject({
        target: sourceTarget,
        classification: { status: 'running', admission: 'override' },
      })
      expect(application.current().automation.overrides[0]?.classification.status).toBe(
        'ineligible',
      )
      const repeated = await application.execute({
        type: 'start-automation-override',
        expectedConfigurationVersion: 1,
        target: sourceTarget,
        stage: 'classification',
      })
      expect(repeated.ok).toBe(false)
      expect(effects).toEqual([])
      expect(await createAutomationDatabaseDocument(databasePath).load()).toEqual(stored)
    } finally {
      await application.stop()
    }
  })

  it('keeps appends immutable in memory', () => {
    const original = database([started()])
    const appended = appendAutomationDatabase(original, { events: [completed()] })

    expect(original.events.map((event) => event.type)).toEqual(['classification-started'])
    expect(appended.events.map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
    ])
  })
})
