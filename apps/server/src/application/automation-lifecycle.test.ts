import * as filesystem from 'node:fs/promises'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { commandSchema } from '@roadmap/contracts/operations'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AutomationAppend,
  type AutomationDatabase,
  createAutomationDatabaseDocument,
  replayAutomationDatabase,
} from '../automation/database.ts'
import type {
  AutomationLaunch,
  AutomationLauncher,
  ClassificationProcessResult,
  WayfinderProcessResult,
} from '../automation/engine.ts'
import { createAutomationLauncher } from '../automation/launcher.ts'
import type { AutomationTarget } from '../automation/model.ts'
import {
  type ConfigurationDocument,
  createConfigurationDocument,
} from '../configuration/document.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import type { HarnessCommand, ProjectConfiguration } from '../projects/registry.ts'
import {
  fixtureProjectRef,
  fixtureTicketRef,
  readApplicationState,
} from '../public-test-fixtures.ts'
import {
  controlledSourceFixture,
  createSourceFixtureOwner,
  type FixtureProject,
  type FixtureTicket,
} from '../source-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) }
})

const roots: string[] = []
const configurationDocuments: ConfigurationDocument[] = []
const RECORDED_AT = '2026-08-29T00:00:00.000Z'
const COMMAND = {
  command: process.execPath,
  args: [],
  promptDelivery: 'stdin' as const,
  promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
}

afterEach(async () => {
  vi.restoreAllMocks()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open)
  vi.mocked(filesystem.rename).mockReset().mockImplementation(actual.rename)
  await Promise.all(configurationDocuments.splice(0).map((document) => document.stop()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function barrier() {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  let didEnter = false
  return {
    async enter() {
      didEnter = true
      entered.resolve()
      await released.promise
    },
    async waitForEntry() {
      await vi.waitFor(() => expect(didEnter, 'The controlled operation must start.').toBe(true))
      await entered.promise
    },
    release: () => released.resolve(),
  }
}

function event(id: string) {
  return { id, opportunityId: 'opportunity', recordedAt: RECORDED_AT }
}

function queued(target: AutomationTarget): AutomationDatabase {
  return {
    schemaVersion: 3,
    opportunities: [{ id: 'opportunity', target }],
    events: [
      {
        ...event('classification-started'),
        type: 'classification-started',
        admission: 'automatic',
      },
      {
        ...event('classification-completed'),
        type: 'classification-completed',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'afk', reason: 'Agent-ready.' },
      },
    ],
  }
}

function interrupted(target: AutomationTarget): AutomationDatabase {
  const database = queued(target)
  return {
    ...database,
    events: [
      ...database.events,
      { ...event('launching'), type: 'wayfinder-launching', admission: 'override' },
      { ...event('running'), type: 'wayfinder-running' },
    ],
  }
}

function classificationResult(): ClassificationProcessResult {
  return {
    status: 'finished',
    code: 0,
    signal: null,
    stdout: JSON.stringify({ schemaVersion: 1, verdict: 'afk', reason: 'Agent-ready.' }),
    stdoutOversized: false,
  }
}

function sessionResult(): WayfinderProcessResult {
  return {
    status: 'finished',
    code: 0,
    signal: null,
    stdout: JSON.stringify({ schemaVersion: 1, outcome: 'completed', reason: 'Resolved.' }),
    stdoutOversized: false,
  }
}

function forbiddenLauncher() {
  const effects: string[] = []
  const launcher: AutomationLauncher = {
    classify() {
      effects.push('classification')
      throw new Error('This schedule must not launch Classification.')
    },
    async dispatch() {
      effects.push('wayfinder')
      throw new Error('This schedule must not launch a Session.')
    },
  }
  return { launcher, effects }
}

async function fixture(options: {
  launcher: AutomationLauncher
  history?: (target: AutomationTarget) => AutomationDatabase
  classificationCommand?: HarnessCommand
  wayfinderCommand?: HarnessCommand
  enabled?: boolean
  invalidConfiguration?: boolean
  beforeLoad?: () => Promise<void>
  beforeAppend?: (batch: AutomationAppend) => Promise<void>
  beforeConfigurationWrite?: (document: ProjectConfiguration) => Promise<void>
}) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-automation-lifecycle-'))
  roots.push(root)
  const workspace = await realpath(root)
  const target: AutomationTarget = {
    project: { integration: 'local', id: 'project' },
    mapId: '.wayfinder/map.md',
    ticketId: 'ticket',
  }
  const ticket: FixtureTicket = {
    id: target.ticketId,
    displayId: target.ticketId,
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
  const project: FixtureProject = {
    key: target.project,
    name: 'Project',
    closedMaps: [],
    warnings: [],
    sourcePath: workspace,
    openMaps: [
      {
        project: target.project,
        id: target.mapId,
        title: 'Map',
        isOpen: true,
        updatedAt: 1,
        body: {
          raw: '',
          destination: 'Reach the destination.',
          notes: [],
          decisions: [],
          notYetSpecified: [],
          notYetSpecifiedNote: '',
          outOfScope: [],
          sections: [],
          missingSections: [],
        },
        tickets: [ticket],
        progress: { total: 1, completed: 0 },
        ticketsComplete: true,
        warnings: [],
        sourcePath: join(workspace, target.mapId),
      },
    ],
  }
  const configuration: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: [
      {
        ref: { integration: 'local', projectId: 'project' },
        connectionId: 'local',
        workspace: { path: workspace },
      },
    ],
    automation: {
      enabled: options.enabled ?? false,
      enabledProjects: [target.project],
      classificationCommand: options.classificationCommand ?? COMMAND,
      wayfinderCommand: options.wayfinderCommand ?? COMMAND,
    },
  }
  const configurationPath = join(root, 'roadmap.config.json')
  const databasePath = join(root, 'automation.json')
  await writeFile(
    configurationPath,
    options.invalidConfiguration ? '{invalid' : JSON.stringify(configuration),
    'utf8',
  )
  const initial = options.history?.(target) ?? { schemaVersion: 3, opportunities: [], events: [] }
  await writeFile(databasePath, JSON.stringify(initial), 'utf8')
  const document = createAutomationDatabaseDocument(databasePath)
  const read = createSourceFixtureOwner()
  const source = controlledSourceFixture(target.project, read([project], 100))
  const selections: string[] = []
  const configurationDocument = createConfigurationDocument(configurationPath, {
    debounceMs: 60_000,
  })
  configurationDocuments.push(configurationDocument)
  const application = createRoadmapApplication({
    configuration: {
      ...configurationDocument,
      async write(document) {
        await options.beforeConfigurationWrite?.(document)
        return configurationDocument.write(document)
      },
    },
    admissions: { local: createLocalProjectAdmission() },
    observers: {
      local: () => source.observer,
      github() {
        throw new Error('This fixture has no GitHub source.')
      },
    },
    automation: {
      launcher: options.launcher,
      database: {
        async load() {
          await options.beforeLoad?.()
          return document.load()
        },
        async append(batch) {
          await options.beforeAppend?.(batch)
          return document.append(batch)
        },
      },
    },
    operations: createApplicationOperations({
      async selectWorkspace() {
        selections.push('selected')
        return workspace
      },
    }),
    serverEpoch: 'automation-lifecycle-test',
  })
  const publications: ReadyApplicationState[] = []
  application.subscribe((state) => {
    if (state.phase === 'ready') publications.push(state)
  })
  return {
    application,
    target,
    workspace,
    fixtureProject: project,
    source,
    configuration,
    configurationPath,
    databasePath,
    selections,
    publications,
    readDatabase: () => createAutomationDatabaseDocument(databasePath).load(),
  }
}

function outcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  )
}

describe('RoadmapApplication Automation lifecycle', () => {
  it.each(['database load', 'recovery append'] as const)(
    'rejects startup after stop during deferred Automation %s and joins concurrent shutdown',
    async (stage) => {
      const gate = barrier()
      const launches = forbiddenLauncher()
      const current = await fixture({
        launcher: launches.launcher,
        history: interrupted,
        beforeLoad: stage === 'database load' ? gate.enter : undefined,
        beforeAppend:
          stage === 'recovery append'
            ? async (batch) => {
                if (batch.events.some((entry) => entry.type === 'wayfinder-outcome-unknown'))
                  await gate.enter()
              }
            : undefined,
      })
      const starting = outcome(current.application.start())
      try {
        await gate.waitForEntry()
        expect(current.application.current()).toMatchObject({ phase: 'starting' })
        expect(await current.application.query({ type: 'select-workspace' })).toMatchObject({
          ok: false,
          error: { code: 'not-supported' },
        })
        const firstStop = current.application.stop()
        const secondStop = current.application.stop()
        const settlements: string[] = []
        void firstStop.then(() => settlements.push('first'))
        void secondStop.then(() => settlements.push('second'))
        await nextTurn()
        expect(settlements).toEqual([])
        gate.release()
        await Promise.all([firstStop, secondStop])
        expect(await starting).toMatchObject({ status: 'rejected' })
        expect(settlements).toEqual(['first', 'second'])
        const stored = await current.readDatabase()
        expect(stored.events.map((entry) => entry.type)).toEqual([
          'classification-started',
          'classification-completed',
          'wayfinder-launching',
          'wayfinder-running',
          'wayfinder-outcome-unknown',
        ])
        expect(replayAutomationDatabase(stored).evidence[0]?.wayfinder).toMatchObject({
          status: 'outcome-unknown',
          acknowledged: false,
        })
        expect(launches.effects).toEqual([])
        expect(current.selections).toEqual([])
        const terminal = current.application.current()
        expect(terminal).toMatchObject({ phase: 'stopped', retained: null })
        expect(current.publications).toEqual([])
        const publicationCount = current.publications.length
        await current.application.stop()
        expect(await outcome(current.application.start())).toMatchObject({ status: 'rejected' })
        await nextTurn()
        expect(current.application.current()).toBe(terminal)
        expect(current.publications).toHaveLength(publicationCount)
        expect(await current.readDatabase()).toEqual(stored)

        const restartConfiguration = createConfigurationDocument(current.configurationPath, {
          debounceMs: 60_000,
        })
        configurationDocuments.push(restartConfiguration)
        const read = createSourceFixtureOwner()
        const restartSource = controlledSourceFixture(
          current.target.project,
          read([current.fixtureProject], 100),
        )
        const restarted = createRoadmapApplication({
          configuration: restartConfiguration,
          admissions: { local: createLocalProjectAdmission() },
          observers: {
            local: () => restartSource.observer,
            github() {
              throw new Error('This recovery fixture has no GitHub source.')
            },
          },
          automation: {
            database: createAutomationDatabaseDocument(current.databasePath),
            launcher: launches.launcher,
          },
        })
        try {
          await restarted.start()
          expect(restarted.current()).toMatchObject({
            phase: 'ready',
            automation: {
              evidence: [
                {
                  target: fixtureTicketRef(current.target),
                  wayfinder: {
                    status: 'outcome-unknown',
                    admission: 'override',
                    acknowledged: false,
                  },
                },
              ],
            },
          })
          expect(await current.readDatabase()).toEqual(stored)
          expect(launches.effects).toEqual([])
        } finally {
          await restarted.stop()
        }
      } finally {
        gate.release()
        await starting
        await current.application.stop()
      }
    },
  )

  it('withholds readiness and all new effects until durable recovery completes', async () => {
    const recovery = barrier()
    const launches = forbiddenLauncher()
    const current = await fixture({
      launcher: launches.launcher,
      history: interrupted,
      enabled: true,
      async beforeAppend(batch) {
        if (batch.events.some((entry) => entry.type === 'wayfinder-outcome-unknown'))
          await recovery.enter()
      },
    })
    const starting = outcome(current.application.start())
    let ready = false
    void starting.then(() => {
      ready = true
    })
    try {
      await recovery.waitForEntry()
      await nextTurn()
      expect(ready).toBe(false)
      expect(await current.application.query({ type: 'select-workspace' })).toMatchObject({
        ok: false,
      })
      expect(
        await current.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target: fixtureTicketRef(current.target),
            stage: 'wayfinder',
          }),
        ),
      ).toMatchObject({ ok: false, error: { code: 'not-supported' } })
      expect(launches.effects).toEqual([])
      expect(current.selections).toEqual([])
      recovery.release()
      expect(await starting).toMatchObject({ status: 'fulfilled' })
      expect(await current.application.query({ type: 'select-workspace' })).toMatchObject({
        ok: true,
        type: 'workspace-selection',
      })
      expect(current.selections).toEqual(['selected'])
      expect(
        readApplicationState(current.application.current()).automation.enabledProjects,
      ).toEqual([])
      expect(
        readApplicationState(current.application.current()).automation.evidence[0]?.wayfinder,
      ).toMatchObject({
        status: 'outcome-unknown',
        admission: 'override',
        acknowledged: false,
      })
      expect(launches.effects).toEqual([])
    } finally {
      recovery.release()
      await starting
      await current.application.stop()
    }
  })

  it('fails startup rather than announcing readiness when durable interruption recovery fails', async () => {
    const launches = forbiddenLauncher()
    const current = await fixture({
      launcher: launches.launcher,
      history: interrupted,
      async beforeAppend() {
        throw new Error('Controlled recovery storage failure.')
      },
    })
    try {
      expect(await outcome(current.application.start())).toMatchObject({ status: 'rejected' })
      expect(await current.application.query({ type: 'select-workspace' })).toMatchObject({
        ok: false,
      })
      expect(current.selections).toEqual([])
      expect(launches.effects).toEqual([])
      expect((await current.readDatabase()).events.map((entry) => entry.type)).toEqual([
        'classification-started',
        'classification-completed',
        'wayfinder-launching',
        'wayfinder-running',
      ])
    } finally {
      await current.application.stop()
    }
  })

  it('keeps invalid startup configuration read-only and disables automatic and override admission', async () => {
    const launches = forbiddenLauncher()
    const current = await fixture({
      launcher: launches.launcher,
      enabled: true,
      invalidConfiguration: true,
    })
    try {
      await current.application.start()
      expect(readApplicationState(current.application.current()).configuration).toMatchObject({
        valid: false,
        issues: [expect.objectContaining({ message: expect.any(String) })],
      })
      expect(
        readApplicationState(current.application.current()).automation.availability.status,
      ).toBe('unavailable')
      expect(
        await current.application.execute(
          commandSchema.parse({
            type: 'set-automation-enabled',
            expectedConfigurationVersion: 0,
            enabled: true,
          }),
        ),
      ).toMatchObject({ ok: false, error: { code: 'configuration-invalid' } })
      for (const stage of ['classification', 'wayfinder'] as const) {
        expect(
          await current.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 0,
              target: fixtureTicketRef(current.target),
              stage,
            }),
          ),
        ).toMatchObject({ ok: false, error: { code: 'configuration-invalid' } })
      }
      expect(await current.application.query({ type: 'select-workspace' })).toMatchObject({
        ok: true,
      })
      expect(await readFile(current.configurationPath, 'utf8')).toBe('{invalid')
      expect((await current.readDatabase()).events).toEqual([])
      expect(launches.effects).toEqual([])
    } finally {
      await current.application.stop()
    }
  })

  it.each(['success', 'failure'] as const)(
    'joins owned Classification cleanup once and ignores its late %s callback',
    async (completion) => {
      const cleanup = barrier()
      const entered = Promise.withResolvers<AutomationLaunch>()
      const completed = Promise.withResolvers<ClassificationProcessResult>()
      const dispatches: AutomationLaunch[] = []
      let stopCalls = 0
      const launcher: AutomationLauncher = {
        classify(request) {
          entered.resolve(request)
          return {
            completed: completed.promise,
            async stop() {
              stopCalls += 1
              await cleanup.enter()
            },
          }
        },
        async dispatch(request) {
          dispatches.push(request)
          return { completed: Promise.resolve(sessionResult()) }
        },
      }
      const current = await fixture({ launcher })
      try {
        await current.application.start()
        expect(
          await current.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target: fixtureTicketRef(current.target),
              stage: 'classification',
            }),
          ),
        ).toMatchObject({ ok: true })
        await entered.promise
        const firstStop = current.application.stop()
        await cleanup.waitForEntry()
        const secondStop = current.application.stop()
        const settled: string[] = []
        void firstStop.then(() => settled.push('first'))
        void secondStop.then(() => settled.push('second'))
        await nextTurn()
        expect(settled).toEqual([])
        expect(stopCalls).toBe(1)
        cleanup.release()
        await Promise.all([firstStop, secondStop])
        const stored = await current.readDatabase()
        expect(stored.events.map((entry) => entry.type)).toEqual([
          'classification-started',
          'classification-outcome-unknown',
        ])
        expect(replayAutomationDatabase(stored).evidence[0]?.classification).toMatchObject({
          status: 'outcome-unknown',
          admission: 'override',
        })
        expect(
          readApplicationState(current.application.current()).automation.evidence[0]
            ?.classification,
        ).toMatchObject({
          status: 'outcome-unknown',
          admission: 'override',
        })
        const terminal = readApplicationState(current.application.current())
        const publicationCount = current.publications.length
        if (completion === 'success') completed.resolve(classificationResult())
        else completed.reject(new Error('Late Classification result loss.'))
        await nextTurn()
        await nextTurn()
        await current.application.stop()
        expect(stopCalls).toBe(1)
        expect(dispatches).toEqual([])
        expect(await current.readDatabase()).toEqual(stored)
        expect(readApplicationState(current.application.current())).toBe(terminal)
        expect(current.publications).toHaveLength(publicationCount)
        expect(stored.events.some((entry) => entry.type === 'classification-completed')).toBe(false)
      } finally {
        cleanup.release()
        completed.resolve(classificationResult())
        await current.application.stop()
      }
    },
  )

  it.each([
    {
      name: 'a signaled process result',
      result: {
        status: 'finished',
        code: null,
        signal: 'SIGTERM',
        stdout: '',
        stdoutOversized: false,
      },
      eventType: 'classification-failed',
      expected: { status: 'failed', processResult: { status: 'signaled', signal: 'SIGTERM' } },
    },
    {
      name: 'an AFK verdict',
      result: classificationResult(),
      eventType: 'classification-completed',
      expected: {
        status: 'completed',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'afk', reason: 'Agent-ready.' },
      },
    },
  ] satisfies {
    name: string
    result: ClassificationProcessResult
    eventType: string
    expected: object
  }[])(
    'preserves $name observed during owned cleanup without admitting an AFK handoff',
    async ({ result, eventType, expected }) => {
      const completed = Promise.withResolvers<ClassificationProcessResult>()
      const dispatches: AutomationLaunch[] = []
      const launcher: AutomationLauncher = {
        classify() {
          return {
            completed: completed.promise,
            async stop() {
              completed.resolve(result)
              await completed.promise
            },
          }
        },
        async dispatch(request) {
          dispatches.push(request)
          return { completed: Promise.resolve(sessionResult()) }
        },
      }
      const current = await fixture({ launcher })
      try {
        await current.application.start()
        expect(
          await current.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target: fixtureTicketRef(current.target),
              stage: 'classification',
            }),
          ),
        ).toMatchObject({ ok: true })
        await current.application.stop()
        const stored = await current.readDatabase()
        expect(stored.events.map((entry) => entry.type)).toEqual([
          'classification-started',
          eventType,
        ])
        expect(replayAutomationDatabase(stored).evidence[0]?.classification).toMatchObject({
          ...expected,
          admission: 'override',
        })
        expect(dispatches).toEqual([])
      } finally {
        completed.resolve(result)
        await current.application.stop()
      }
    },
  )

  it('joins a harmless owned Classification process and retains its actual shutdown signal', async () => {
    const current = await fixture({
      launcher: createAutomationLauncher({ stopGraceMs: 100 }),
      classificationCommand: {
        ...COMMAND,
        args: [
          '-e',
          [
            "require('node:fs').writeFileSync('classification.started', 'started');",
            'process.stdin.resume();',
            'setInterval(() => {}, 1000);',
          ].join('\n'),
        ],
      },
    })
    try {
      await current.application.start()
      expect(
        await current.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target: fixtureTicketRef(current.target),
            stage: 'classification',
          }),
        ),
      ).toMatchObject({ ok: true })
      await vi.waitFor(async () =>
        expect(await readFile(join(current.workspace, 'classification.started'), 'utf8')).toBe(
          'started',
        ),
      )
      await Promise.all([current.application.stop(), current.application.stop()])
      const stored = await current.readDatabase()
      expect(stored.events.map((entry) => entry.type)).toEqual([
        'classification-started',
        'classification-failed',
      ])
      expect(replayAutomationDatabase(stored).evidence[0]?.classification).toMatchObject({
        status: 'failed',
        admission: 'override',
        processResult: { status: 'signaled', signal: 'SIGTERM' },
      })
      expect(current.source.stopped).toBe(true)
      await current.application.stop()
      expect(await current.readDatabase()).toEqual(stored)
    } finally {
      await current.application.stop()
    }
  })

  it('lets a harmless external Session finish independently after joined application shutdown', async () => {
    const current = await fixture({
      launcher: createAutomationLauncher({ stopGraceMs: 100 }),
      history: queued,
      wayfinderCommand: {
        ...COMMAND,
        args: [
          '-e',
          [
            "const fs = require('node:fs');",
            "fs.writeFileSync('session.started', 'started');",
            'process.stdin.resume();',
            'const timer = setInterval(() => {',
            "  if (!fs.existsSync('session.release')) return;",
            "  fs.writeFileSync('session.finished', 'finished');",
            "  process.stdout.write(JSON.stringify({ schemaVersion: 1, outcome: 'completed', reason: 'Harmless Session finished.' }));",
            '  clearInterval(timer);',
            '}, 10);',
          ].join('\n'),
        ],
      },
    })
    let admitted = false
    const releasePath = join(current.workspace, 'session.release')
    const finishedPath = join(current.workspace, 'session.finished')
    try {
      await current.application.start()
      const admission = await current.application.execute(
        commandSchema.parse({
          type: 'start-automation-override',
          expectedConfigurationVersion: 1,
          target: fixtureTicketRef(current.target),
          stage: 'wayfinder',
        }),
      )
      admitted = admission.ok
      expect(admission).toMatchObject({ ok: true })
      await vi.waitFor(async () =>
        expect(await readFile(join(current.workspace, 'session.started'), 'utf8')).toBe('started'),
      )
      await Promise.all([current.application.stop(), current.application.stop()])
      await expect(readFile(finishedPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      const stored = await current.readDatabase()
      expect(replayAutomationDatabase(stored).evidence[0]?.wayfinder).toMatchObject({
        status: 'outcome-unknown',
        admission: 'override',
        acknowledged: false,
      })
      const terminal = readApplicationState(current.application.current())
      const publicationCount = current.publications.length
      await writeFile(releasePath, 'release', 'utf8')
      await vi.waitFor(async () => expect(await readFile(finishedPath, 'utf8')).toBe('finished'))
      await nextTurn()
      await nextTurn()
      expect(await current.readDatabase()).toEqual(stored)
      expect(readApplicationState(current.application.current())).toBe(terminal)
      expect(current.publications).toHaveLength(publicationCount)
    } finally {
      await writeFile(releasePath, 'release', 'utf8')
      await current.application.stop()
      if (admitted)
        await vi.waitFor(async () => expect(await readFile(finishedPath, 'utf8')).toBe('finished'))
    }
  })

  it('joins one failing owned cleanup and preserves the same failure for repeated stop', async () => {
    const cleanup = barrier()
    const completed = Promise.withResolvers<ClassificationProcessResult>()
    const failure = new Error('Controlled Classification cleanup failure.')
    let stopCalls = 0
    const launcher: AutomationLauncher = {
      classify() {
        return {
          completed: completed.promise,
          async stop() {
            stopCalls += 1
            await cleanup.enter()
            throw failure
          },
        }
      },
      async dispatch() {
        throw new Error('Cleanup cannot admit a Session.')
      },
    }
    const current = await fixture({ launcher })
    try {
      await current.application.start()
      expect(
        await current.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target: fixtureTicketRef(current.target),
            stage: 'classification',
          }),
        ),
      ).toMatchObject({ ok: true })
      const firstStop = outcome(current.application.stop())
      await cleanup.waitForEntry()
      const secondStop = outcome(current.application.stop())
      cleanup.release()
      expect(await firstStop).toMatchObject({ status: 'rejected' })
      expect(await secondStop).toMatchObject({ status: 'rejected' })
      expect(await outcome(current.application.stop())).toMatchObject({ status: 'rejected' })
      expect(stopCalls).toBe(1)
      expect(current.source.stopped).toBe(true)
    } finally {
      cleanup.release()
      completed.resolve(classificationResult())
      await outcome(current.application.stop())
    }
  })

  it('joins interruption persistence and reports its failure on every stop without inventing a Session result', async () => {
    const persistence = barrier()
    const completed = Promise.withResolvers<WayfinderProcessResult>()
    const launcher: AutomationLauncher = {
      classify() {
        throw new Error('This Session already has an AFK Verdict.')
      },
      async dispatch() {
        return { completed: completed.promise }
      },
    }
    const current = await fixture({
      launcher,
      history: queued,
      async beforeAppend(batch) {
        if (!batch.events.some((entry) => entry.type === 'wayfinder-outcome-unknown')) return
        await persistence.enter()
        throw new Error('Controlled interruption persistence failure.')
      },
    })
    try {
      await current.application.start()
      expect(
        await current.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target: fixtureTicketRef(current.target),
            stage: 'wayfinder',
          }),
        ),
      ).toMatchObject({ ok: true })
      await vi.waitFor(() =>
        expect(
          readApplicationState(current.application.current()).automation.evidence[0]?.wayfinder
            ?.status,
        ).toBe('running'),
      )
      const firstStop = outcome(current.application.stop())
      await persistence.waitForEntry()
      const secondStop = outcome(current.application.stop())
      let settled = false
      void Promise.all([firstStop, secondStop]).then(() => {
        settled = true
      })
      await nextTurn()
      expect(settled).toBe(false)
      persistence.release()
      expect(await firstStop).toMatchObject({ status: 'rejected' })
      expect(await secondStop).toMatchObject({ status: 'rejected' })
      expect(await outcome(current.application.stop())).toMatchObject({ status: 'rejected' })
      const stored = await current.readDatabase()
      expect(stored.events.map((entry) => entry.type)).toEqual([
        'classification-started',
        'classification-completed',
        'wayfinder-launching',
        'wayfinder-running',
      ])
      const terminal = readApplicationState(current.application.current())
      const publicationCount = current.publications.length
      completed.resolve(sessionResult())
      await nextTurn()
      await nextTurn()
      expect(await current.readDatabase()).toEqual(stored)
      expect(readApplicationState(current.application.current())).toBe(terminal)
      expect(current.publications).toHaveLength(publicationCount)
      expect(current.source.stopped).toBe(true)
    } finally {
      persistence.release()
      completed.resolve(sessionResult())
      await outcome(current.application.stop())
    }
  })

  it.each(['precommit rename', 'unconfirmed directory sync', 'confirmed directory close'] as const)(
    'retains actual disk truth and the repeated shutdown result after %s failure',
    async (failure) => {
      const completed = Promise.withResolvers<WayfinderProcessResult>()
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      const launcher: AutomationLauncher = {
        classify() {
          throw new Error('This Session already has an AFK Verdict.')
        },
        async dispatch() {
          return { completed: completed.promise }
        },
      }
      const current = await fixture({
        launcher,
        history: queued,
        async beforeAppend(batch) {
          if (!batch.events.some((entry) => entry.type === 'wayfinder-outcome-unknown')) return
          if (failure === 'precommit rename') {
            vi.mocked(filesystem.rename).mockRejectedValueOnce(
              new Error('Controlled interruption rename failure.'),
            )
            return
          }
          let injected = false
          vi.mocked(filesystem.open).mockImplementation(async (file, flags, mode) => {
            const handle = await actual.open(file, flags, mode)
            if (file === dirname(current.databasePath) && !injected) {
              injected = true
              if (failure === 'unconfirmed directory sync') {
                vi.spyOn(handle, 'sync').mockRejectedValueOnce(
                  new Error('Controlled interruption directory sync failure.'),
                )
              } else {
                const close = handle.close.bind(handle)
                vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
                  await close()
                  throw new Error('Controlled interruption directory close failure.')
                })
              }
            }
            return handle
          })
        },
      })
      try {
        await current.application.start()
        expect(
          await current.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target: fixtureTicketRef(current.target),
              stage: 'wayfinder',
            }),
          ),
        ).toMatchObject({ ok: true })
        await vi.waitFor(() =>
          expect(
            readApplicationState(current.application.current()).automation.evidence[0]?.wayfinder
              ?.status,
          ).toBe('running'),
        )
        const stops = await Promise.all([
          outcome(current.application.stop()),
          outcome(current.application.stop()),
        ])
        const expectedStatus = failure === 'confirmed directory close' ? 'fulfilled' : 'rejected'
        expect(stops).toMatchObject([{ status: expectedStatus }, { status: expectedStatus }])
        expect(await outcome(current.application.stop())).toMatchObject({ status: expectedStatus })
        const stored = await current.readDatabase()
        expect(stored.events.map((entry) => entry.type)).toEqual([
          'classification-started',
          'classification-completed',
          'wayfinder-launching',
          'wayfinder-running',
          ...(failure === 'precommit rename' ? [] : ['wayfinder-outcome-unknown']),
        ])
        const expectedPhase = failure === 'precommit rename' ? 'running' : 'outcome-unknown'
        expect(replayAutomationDatabase(stored).evidence[0]?.wayfinder).toMatchObject({
          status: expectedPhase,
          admission: 'override',
        })
        expect(
          readApplicationState(current.application.current()).automation.evidence[0]?.wayfinder,
        ).toMatchObject({
          status: expectedPhase,
          admission: 'override',
        })
        expect(current.source.stopped).toBe(true)
        const terminal = readApplicationState(current.application.current())
        const publicationCount = current.publications.length
        completed.reject(new Error('Late external Session result loss.'))
        await nextTurn()
        await nextTurn()
        expect(await current.readDatabase()).toEqual(stored)
        expect(readApplicationState(current.application.current())).toBe(terminal)
        expect(current.publications).toHaveLength(publicationCount)
      } finally {
        completed.resolve(sessionResult())
        await outcome(current.application.stop())
      }
    },
  )

  it.each(['precommit rename', 'unconfirmed directory sync', 'conflict'] as const)(
    'reports Project disablement %s failure without changing interrupted Session evidence',
    async (failure) => {
      const completed = Promise.withResolvers<WayfinderProcessResult>()
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      const current = await fixture({
        history: queued,
        launcher: {
          classify() {
            throw new Error('This Session already has an AFK Verdict.')
          },
          async dispatch() {
            return { completed: completed.promise }
          },
        },
      })
      try {
        await current.application.start()
        expect(
          await current.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target: fixtureTicketRef(current.target),
              stage: 'wayfinder',
            }),
          ),
        ).toMatchObject({ ok: true })
        await vi.waitFor(() =>
          expect(
            readApplicationState(current.application.current()).automation.evidence[0]?.wayfinder
              ?.status,
          ).toBe('running'),
        )
        if (failure === 'conflict') {
          await writeFile(
            current.configurationPath,
            JSON.stringify({ ...current.configuration, configurationVersion: 2 }),
            'utf8',
          )
        } else {
          let replaced = false
          vi.mocked(filesystem.rename).mockImplementation(async (from, to) => {
            if (to === current.configurationPath && failure === 'precommit rename')
              throw new Error('Controlled Project disablement rename failure.')
            await actual.rename(from, to)
            if (to === current.configurationPath) replaced = true
          })
          vi.mocked(filesystem.open).mockImplementation(async (file, flags, mode) => {
            const handle = await actual.open(file, flags, mode)
            if (replaced && file === dirname(current.configurationPath)) {
              replaced = false
              vi.spyOn(handle, 'sync').mockRejectedValueOnce(
                new Error('Controlled Project disablement directory sync failure.'),
              )
            }
            return handle
          })
        }
        const publicationCount = current.publications.length
        const stopping = current.application.stop()
        expect(current.application.stop()).toBe(stopping)
        const result = await outcome(stopping)
        expect(result).toMatchObject({ status: 'rejected' })
        const repeated = await outcome(current.application.stop())
        expect(repeated).toEqual(result)
        if (result.status === 'rejected' && repeated.status === 'rejected')
          expect(repeated.error).toBe(result.error)
        const saved: unknown = JSON.parse(await readFile(current.configurationPath, 'utf8'))
        const disabled = failure === 'unconfirmed directory sync'
        expect(saved).toMatchObject({
          configurationVersion: failure === 'precommit rename' ? 1 : 2,
          automation: { enabledProjects: disabled ? [] : [current.target.project] },
        })
        const stored = await current.readDatabase()
        expect(replayAutomationDatabase(stored).evidence[0]?.wayfinder).toMatchObject({
          status: 'outcome-unknown',
          admission: 'override',
          acknowledged: false,
        })
        expect(readApplicationState(current.application.current())).toMatchObject({
          configurationVersion: disabled ? 2 : 1,
          automation: {
            enabledProjects: disabled ? [] : [fixtureProjectRef(current.target.project)],
            evidence: [{ wayfinder: { status: 'outcome-unknown', acknowledged: false } }],
          },
        })
        expect(
          readApplicationState(current.application.current()).configuration.notices.length,
        ).toBeGreaterThan(0)
        if (disabled)
          expect(
            readApplicationState(current.application.current()).automation.availability,
          ).toMatchObject({
            status: 'unavailable',
          })
        expect(current.application.diagnostics().lifecycle).toEqual({ phase: 'stopped' })
        expect(current.source.stopped).toBe(true)
        expect(current.publications).toHaveLength(publicationCount)
        const terminal = readApplicationState(current.application.current())
        completed.resolve(sessionResult())
        await nextTurn()
        await nextTurn()
        expect(await current.readDatabase()).toEqual(stored)
        expect(readApplicationState(current.application.current())).toBe(terminal)
        expect(current.publications).toHaveLength(publicationCount)
      } finally {
        completed.resolve(sessionResult())
        await outcome(current.application.stop())
      }
    },
  )

  it('joins a begun configuration write before persisting interrupted Project disablement', async () => {
    const writing = barrier()
    const completed = Promise.withResolvers<WayfinderProcessResult>()
    const current = await fixture({
      history: queued,
      async beforeConfigurationWrite(document) {
        if (document.configurationVersion === 2) await writing.enter()
      },
      launcher: {
        classify() {
          throw new Error('This Session already has an AFK Verdict.')
        },
        async dispatch() {
          return { completed: completed.promise }
        },
      },
    })
    let command: ReturnType<typeof current.application.execute> | undefined
    let stopping: Promise<unknown> | undefined
    try {
      await current.application.start()
      expect(
        await current.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target: fixtureTicketRef(current.target),
            stage: 'wayfinder',
          }),
        ),
      ).toMatchObject({ ok: true })
      await vi.waitFor(() =>
        expect(
          readApplicationState(current.application.current()).automation.evidence[0]?.wayfinder
            ?.status,
        ).toBe('running'),
      )
      command = current.application.execute(
        commandSchema.parse({
          type: 'rename-project',
          project: fixtureProjectRef(current.target.project),
          name: 'Renamed before shutdown',
          expectedConfigurationVersion: 1,
        }),
      )
      await writing.waitForEntry()
      const publicationCount = current.publications.length
      let settled = false
      stopping = outcome(current.application.stop()).then((result) => {
        settled = true
        return result
      })
      await nextTurn()
      expect(settled).toBe(false)
      writing.release()
      const commandOutcome = await command
      expect(commandOutcome).toMatchObject({
        ok: true,
        result: { type: 'configuration-updated', configurationVersion: 2 },
        state: { phase: 'stopping', retained: { phase: 'ready', configurationVersion: 2 } },
      })
      if (commandOutcome.ok && commandOutcome.result.type === 'configuration-updated')
        expect(commandOutcome.result.configurationVersion).toBe(
          readApplicationState(commandOutcome.state).configurationVersion,
        )
      expect(await stopping).toMatchObject({ status: 'fulfilled' })
      expect(current.application.current()).toMatchObject({
        phase: 'stopped',
        retained: { phase: 'ready', configurationVersion: 3 },
      })
      const saved: unknown = JSON.parse(await readFile(current.configurationPath, 'utf8'))
      expect(saved).toMatchObject({
        configurationVersion: 3,
        projects: [{ displayName: 'Renamed before shutdown' }],
        automation: { enabledProjects: [] },
      })
      expect(readApplicationState(current.application.current())).toMatchObject({
        configurationVersion: 3,
        automation: {
          enabledProjects: [],
          evidence: [{ wayfinder: { status: 'outcome-unknown' } }],
        },
      })
      expect(current.source.stopped).toBe(true)
      expect(current.publications).toHaveLength(publicationCount)
    } finally {
      writing.release()
      completed.resolve(sessionResult())
      await command
      await (stopping ?? outcome(current.application.stop()))
    }
  })

  it.each([
    {
      phase: 'launching',
      completion: 'success',
      expectedEvents: [
        'classification-started',
        'classification-completed',
        'wayfinder-launching',
        'wayfinder-outcome-unknown',
      ],
    },
    {
      phase: 'launching',
      completion: 'failure',
      expectedEvents: [
        'classification-started',
        'classification-completed',
        'wayfinder-launching',
        'wayfinder-outcome-unknown',
      ],
    },
    {
      phase: 'running',
      completion: 'success',
      expectedEvents: [
        'classification-started',
        'classification-completed',
        'wayfinder-launching',
        'wayfinder-running',
        'wayfinder-outcome-unknown',
      ],
    },
    {
      phase: 'running',
      completion: 'failure',
      expectedEvents: [
        'classification-started',
        'classification-completed',
        'wayfinder-launching',
        'wayfinder-running',
        'wayfinder-outcome-unknown',
      ],
    },
  ] as const)(
    'keeps a $phase external Session unknown after concurrent stop and late $completion',
    async ({ phase, completion, expectedEvents }) => {
      const entered = Promise.withResolvers<AutomationLaunch>()
      const launch = Promise.withResolvers<{ completed: Promise<WayfinderProcessResult> }>()
      const completed = Promise.withResolvers<WayfinderProcessResult>()
      let externalSettled = false
      void completed.promise.then(
        () => {
          externalSettled = true
        },
        () => {
          externalSettled = true
        },
      )
      const launcher: AutomationLauncher = {
        classify() {
          throw new Error('This Session already has an AFK Classification.')
        },
        dispatch(request) {
          entered.resolve(request)
          return launch.promise
        },
      }
      const current = await fixture({ launcher, history: queued })
      try {
        await current.application.start()
        expect(
          await current.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target: fixtureTicketRef(current.target),
              stage: 'wayfinder',
            }),
          ),
        ).toMatchObject({ ok: true })
        await entered.promise
        if (phase === 'running') {
          launch.resolve({ completed: completed.promise })
          await vi.waitFor(() =>
            expect(
              readApplicationState(current.application.current()).automation.evidence[0]?.wayfinder
                ?.status,
            ).toBe('running'),
          )
        }
        expect(
          readApplicationState(current.application.current()).automation.evidence[0]?.wayfinder
            ?.status,
        ).toBe(phase)
        const firstStop = current.application.stop()
        const secondStop = current.application.stop()
        const stops = [outcome(firstStop), outcome(secondStop)]
        let stopSettled = false
        void Promise.all(stops).then(() => {
          stopSettled = true
        })
        if (phase === 'launching') {
          await nextTurn()
          expect(stopSettled).toBe(false)
          if (completion === 'success') launch.resolve({ completed: completed.promise })
          else launch.reject(new Error('Late Session launch failure.'))
        }
        expect(await Promise.all(stops)).toMatchObject([
          { status: 'fulfilled' },
          { status: 'fulfilled' },
        ])
        expect(externalSettled).toBe(false)
        const stored = await current.readDatabase()
        expect(stored.events.map((entry) => entry.type)).toEqual(expectedEvents)
        expect(replayAutomationDatabase(stored).evidence[0]?.wayfinder).toMatchObject({
          status: 'outcome-unknown',
          admission: 'override',
          acknowledged: false,
        })
        expect(current.application.current()).toMatchObject({
          phase: 'stopped',
          retained: {
            phase: 'ready',
            automation: {
              evidence: [
                {
                  target: fixtureTicketRef(current.target),
                  wayfinder: {
                    status: 'outcome-unknown',
                    admission: 'override',
                    acknowledged: false,
                  },
                },
              ],
            },
          },
        })
        const saved: unknown = JSON.parse(await readFile(current.configurationPath, 'utf8'))
        expect(saved).toMatchObject({ automation: { enabledProjects: [] } })
        const terminal = readApplicationState(current.application.current())
        const publicationCount = current.publications.length
        if (completion === 'success') completed.resolve(sessionResult())
        else completed.reject(new Error('Late Session result loss.'))
        await nextTurn()
        await nextTurn()
        await current.application.stop()
        expect(await current.readDatabase()).toEqual(stored)
        expect(readApplicationState(current.application.current())).toBe(terminal)
        expect(current.publications).toHaveLength(publicationCount)
        expect(
          await current.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: readApplicationState(current.application.current())
                .configurationVersion,
              target: fixtureTicketRef(current.target),
              stage: 'wayfinder',
            }),
          ),
        ).toMatchObject({ ok: false, error: { code: 'not-supported' } })
      } finally {
        launch.resolve({ completed: completed.promise })
        completed.resolve(sessionResult())
        await current.application.stop()
      }
    },
  )
})
