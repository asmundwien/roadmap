import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  AutomationEvidence,
  AutomationTarget,
  Project,
  ProjectKey,
  Ticket,
  TicketTypeEvidence,
  WayfinderMap,
} from '@roadmap/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterHost, WayfinderAdapter } from '../store.ts'
import { isRecord } from '../type-guards.ts'
import { createRoadmapApplication } from './application.ts'
import {
  type AutomationLaunch,
  type AutomationLauncher,
  type ClassificationProcessResult,
  createAutomationLauncher,
  type WayfinderProcessResult,
} from './automation.ts'
import {
  type AutomationAppend,
  type AutomationDatabase,
  type AutomationDatabaseDocument,
  type AutomationEvent,
  appendAutomationDatabase,
  createAutomationDatabaseDocument,
  replayAutomationDatabase,
} from './automation-database.ts'
import { classificationResultSchemaJson } from './classification-contract.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
  HarnessCommand,
  RoadmapConfiguration,
} from './configuration.ts'
import { sessionReportSchemaJson } from './session-report-contract.ts'

const TASK: TicketTypeEvidence = { kind: 'recognized', value: 'task', labels: ['task'] }
const COMMAND: HarnessCommand = {
  command: process.execPath,
  args: ['-e', 'process.stdin.resume()'],
  promptDelivery: 'stdin',
  promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
}
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function ticket(
  id: string,
  typeEvidence: TicketTypeEvidence = TASK,
  overrides: Partial<Ticket> = {},
): Ticket {
  return {
    id,
    displayId: id,
    title: `Ticket ${id}`,
    body: 'Resolve the route.',
    typeEvidence,
    state: 'frontier',
    isClaimed: false,
    isBlocked: false,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
    sourcePath: `/tmp/project-${id}/.wayfinder/tickets/${id}.md`,
    ...overrides,
  }
}

function map(
  project: ProjectKey,
  tickets: Ticket[],
  overrides: Partial<WayfinderMap> = {},
): WayfinderMap {
  return {
    project,
    id: 'map',
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
    tickets,
    frontier: tickets.filter((candidate) => candidate.state === 'frontier'),
    progress: { total: tickets.length, completed: 0 },
    ticketsComplete: true,
    warnings: [],
    sourcePath: `/tmp/project-${project.id}/.wayfinder/map.md`,
    ...overrides,
  }
}

function project(id: string, tickets: Ticket[], overrides: Partial<Project> = {}): Project {
  const key = { integration: 'local' as const, id }
  return {
    key,
    name: id,
    openMaps: [map(key, tickets)],
    closedMaps: [],
    warnings: [],
    ...overrides,
  }
}

function memoryConfiguration(
  initial: RoadmapConfiguration,
  writeResult: ConfigurationWrite = { ok: true },
) {
  let current = initial
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const writes: RoadmapConfiguration[] = []
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: current }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next): Promise<ConfigurationWrite> {
      writes.push(next)
      if (!writeResult.ok) return writeResult
      current = next
      return writeResult
    },
    async stop() {},
  }
  return {
    document,
    writes,
    emit(next: RoadmapConfiguration) {
      current = next
      for (const listener of listeners) listener({ ok: true, document: next })
    },
  }
}

interface MemoryAutomationDatabase {
  database: AutomationDatabaseDocument
  evidence(): AutomationEvidence[]
  events(): readonly AutomationEvent[]
  writes: AutomationDatabase[]
}

function memoryAutomationDatabase(
  initial: AutomationDatabase = { schemaVersion: 3, opportunities: [], events: [] },
  options: { failAppend?: (batch: AutomationAppend) => boolean } = {},
): MemoryAutomationDatabase {
  let current = initial
  const writes: AutomationDatabase[] = []
  const database: AutomationDatabaseDocument = {
    async load() {
      return current
    },
    async append(batch) {
      if (options.failAppend?.(batch)) throw new Error('Automation database is read-only.')
      current = appendAutomationDatabase(current, batch)
      writes.push(current)
      return current
    },
  }
  return {
    database,
    evidence: () => [...replayAutomationDatabase(current).evidence],
    events: () => current.events,
    writes,
  }
}

function adapter(initial: Project[]) {
  let host: AdapterHost | null = null
  let projects = initial
  const value: WayfinderAdapter = {
    type: 'local',
    start(nextHost) {
      host = nextHost
      host.update({ projects, unreachable: [] })
    },
    stop() {},
  }
  return {
    value,
    push(next: Project[]) {
      projects = next
      if (!host) throw new Error('Adapter has not started.')
      host.update({ projects, unreachable: [] })
    },
  }
}

function configuration(
  projects: Project[],
  overrides: Partial<RoadmapConfiguration['automation']> = {},
): RoadmapConfiguration {
  return {
    schemaVersion: 5,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: projects.map((entry) => ({
      key: entry.key,
      connectionId: 'local',
      locator: { integration: 'local', path: `/tmp/${entry.key.id}` },
      workspace: { path: `/tmp/${entry.key.id}` },
    })),
    automation: {
      enabled: true,
      classificationCommand: COMMAND,
      wayfinderCommand: COMMAND,
      enabledProjects: projects.map((entry) => entry.key),
      ...overrides,
    },
  }
}

function processResult(
  overrides: Partial<
    Omit<Extract<ClassificationProcessResult, { status: 'finished' }>, 'status'>
  > = {},
): ClassificationProcessResult {
  return {
    status: 'finished',
    code: 0,
    signal: null,
    stdout: JSON.stringify({ schemaVersion: 1, verdict: 'afk', reason: 'Agent-ready.' }),
    stdoutOversized: false,
    ...overrides,
  }
}
function wayfinderResult(
  overrides: Partial<Omit<WayfinderProcessResult, 'status'>> = {},
): WayfinderProcessResult {
  return {
    status: 'finished',
    code: 0,
    signal: null,
    stdout: JSON.stringify({
      schemaVersion: 1,
      outcome: 'completed',
      reason: 'Ticket resolved.',
    }),
    stdoutOversized: false,
    ...overrides,
  }
}

function deferredLauncher(
  options: {
    beforeClassify?: (request: AutomationLaunch) => void
    beforeDispatch?: (request: AutomationLaunch) => void
    dispatchError?: Error
    dispatchGate?: Promise<void>
  } = {},
) {
  const classifications: Array<{
    request: AutomationLaunch
    resolve(result: ClassificationProcessResult): void
    reject(error: Error): void
    stopped: boolean
  }> = []
  const dispatches: AutomationLaunch[] = []
  const sessions: Array<{
    resolve(result: WayfinderProcessResult): void
    reject(error: Error): void
  }> = []
  let running = 0
  let maximumRunning = 0
  const launcher: AutomationLauncher = {
    classify(request) {
      options.beforeClassify?.(request)
      running += 1
      maximumRunning = Math.max(maximumRunning, running)
      const { promise, resolve, reject } = Promise.withResolvers<ClassificationProcessResult>()
      const launch = {
        request,
        stopped: false,
        resolve(result: ClassificationProcessResult) {
          running -= 1
          resolve(result)
        },
        reject(error: Error) {
          running -= 1
          reject(error)
        },
      }
      classifications.push(launch)
      return {
        completed: promise,
        async stop() {
          launch.stopped = true
          launch.resolve(processResult({ signal: 'SIGTERM' }))
          await promise
        },
      }
    },
    async dispatch(request) {
      options.beforeDispatch?.(request)
      dispatches.push(request)
      if (options.dispatchError) throw options.dispatchError
      await options.dispatchGate
      const { promise, resolve, reject } = Promise.withResolvers<WayfinderProcessResult>()
      sessions.push({ resolve, reject })
      return { completed: promise }
    },
  }
  return {
    launcher,
    classifications,
    dispatches,
    sessions,
    maximumRunning: () => maximumRunning,
  }
}

async function harness(options: {
  projects: Project[]
  launcher: AutomationLauncher
  database?: MemoryAutomationDatabase
  configuration?: RoadmapConfiguration
  configurationWriteResult?: ConfigurationWrite
}) {
  const source = adapter(options.projects)
  const database = options.database ?? memoryAutomationDatabase()
  const configured = memoryConfiguration(
    options.configuration ?? configuration(options.projects),
    options.configurationWriteResult,
  )
  const application = createRoadmapApplication({
    configuration: configured.document,
    automation: { database: database.database, launcher: options.launcher },
    createAdapters: () => [source.value],
    serverEpoch: 'automation-test',
  })
  await application.start()
  return { application, source, database, configured }
}
const RECORDED_AT = '2026-08-29T00:00:00.000Z'

function storedEvent(id: string, opportunityId = 'opportunity') {
  return { id, opportunityId, recordedAt: RECORDED_AT }
}

function queuedDatabase(targets: readonly AutomationTarget[]): AutomationDatabase {
  return {
    schemaVersion: 3,
    opportunities: targets.map((target, index) => ({ id: `opportunity-${index}`, target })),
    events: targets.flatMap((_, index): AutomationEvent[] => [
      {
        ...storedEvent(`classification-started-${index}`, `opportunity-${index}`),
        type: 'classification-started',
        admission: 'automatic',
      },
      {
        ...storedEvent(`classification-completed-${index}`, `opportunity-${index}`),
        type: 'classification-completed',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'afk', reason: 'Agent-ready.' },
      },
    ]),
  }
}

describe('RoadmapApplication Automation', () => {
  it('recovers interrupted Sessions before leaving other Projects running on startup', async () => {
    const interrupted = project('restart', [ticket('1')])
    const unaffected = project('unaffected', [ticket('2')])
    const targets = [
      { project: interrupted.key, mapId: 'map', ticketId: '1' },
      { project: unaffected.key, mapId: 'map', ticketId: '2' },
    ]
    const active = appendAutomationDatabase(queuedDatabase(targets), {
      events: [
        {
          ...storedEvent('wayfinder-launching', 'opportunity-0'),
          type: 'wayfinder-launching',
          admission: 'override',
        },
        {
          ...storedEvent('wayfinder-running', 'opportunity-0'),
          type: 'wayfinder-running',
        },
      ],
    })
    const database = memoryAutomationDatabase(active)
    const launches = deferredLauncher()
    const current = await harness({
      projects: [interrupted, unaffected],
      launcher: launches.launcher,
      database,
    })

    expect(database.evidence()[0]?.wayfinder).toMatchObject({
      status: 'outcome-unknown',
      admission: 'override',
      reason: expect.stringContaining('restarted'),
    })
    expect(current.configured.writes[0]?.automation.enabledProjects).toEqual([unaffected.key])
    expect(launches.dispatches).toHaveLength(1)
    expect(launches.dispatches[0]?.environment.ROADMAP_TICKET_ID).toBe('2')
    await current.application.stop()
  })

  it('records a running Session as interrupted and disables its Project on graceful stop', async () => {
    const sourceProject = project('stopping', [ticket('1')])
    const database = memoryAutomationDatabase(
      queuedDatabase([{ project: sourceProject.key, mapId: 'map', ticketId: '1' }]),
    )
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
    })
    await vi.waitFor(() => expect(database.evidence()[0]?.wayfinder?.status).toBe('running'))

    await current.application.stop()

    expect(database.evidence()[0]?.wayfinder).toMatchObject({
      status: 'outcome-unknown',
      reason: expect.stringContaining('stopped'),
    })
    expect(current.configured.writes.at(-1)?.automation.enabledProjects).toEqual([])
  })

  it('records a still-launching Session as interrupted without waiting for launch', async () => {
    const sourceProject = project('launching-stop', [ticket('1')])
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
    const database = memoryAutomationDatabase(queuedDatabase([target]))
    const gate = Promise.withResolvers<void>()
    const launches = deferredLauncher({ dispatchGate: gate.promise })
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
    })
    expect(database.evidence()[0]?.wayfinder?.status).toBe('launching')

    await current.application.stop()

    expect(database.evidence()[0]?.wayfinder).toMatchObject({
      status: 'outcome-unknown',
      reason: expect.stringContaining('stopped'),
    })
    expect(current.configured.writes.at(-1)?.automation.enabledProjects).toEqual([])
    gate.resolve()
  })

  it('acknowledges the exact interruption before re-enabling and resuming queued work', async () => {
    const sourceProject = project('resume', [ticket('1'), ticket('2')])
    const targets = ['1', '2'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: 'map',
      ticketId,
    }))
    const unknown = {
      ...storedEvent('unknown', 'opportunity-0'),
      type: 'wayfinder-outcome-unknown',
      reason: 'Roadmap stopped.',
    } satisfies AutomationEvent
    const interrupted = appendAutomationDatabase(queuedDatabase(targets), {
      events: [
        {
          ...storedEvent('wayfinder-launching', 'opportunity-0'),
          type: 'wayfinder-launching',
          admission: 'automatic',
        },
        unknown,
      ],
    })
    const database = memoryAutomationDatabase(interrupted)
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
      configuration: configuration([sourceProject], { enabledProjects: [] }),
    })
    expect(current.application.current().automation.enabledProjects).toEqual([])
    expect(
      current.application
        .current()
        .automation.evidence.find((entry) => entry.target.ticketId === '1')?.wayfinder,
    ).toMatchObject({
      status: 'outcome-unknown',
      admission: 'automatic',
      acknowledged: false,
    })

    const blocked = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target: { project: sourceProject.key, mapId: 'map', ticketId: '2' },
      stage: 'wayfinder',
    })
    expect(blocked).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('must be acknowledged') },
    })

    const enabled = await current.application.execute({
      type: 'set-project-automation-enabled',
      expectedConfigurationVersion: 1,
      project: sourceProject.key,
      enabled: true,
    })

    expect(enabled).toMatchObject({ ok: true, result: { configurationVersion: 2 } })
    expect(
      database.events().find((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
    ).toMatchObject({ opportunityId: 'opportunity-0', unknownEventId: unknown.id })
    expect(
      current.application
        .current()
        .automation.evidence.find((entry) => entry.target.ticketId === '1')?.wayfinder,
    ).toMatchObject({ status: 'outcome-unknown', acknowledged: true })
    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    expect(launches.dispatches[0]?.environment.ROADMAP_TICKET_ID).toBe('2')
    await current.application.stop()
  })

  it('does not re-enable when the interruption acknowledgement cannot persist', async () => {
    const sourceProject = project('ack-failure', [ticket('1')])
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
    const unknown = {
      ...storedEvent('unknown', 'opportunity-0'),
      type: 'wayfinder-outcome-unknown',
      reason: 'Roadmap stopped.',
    } satisfies AutomationEvent
    const interrupted = appendAutomationDatabase(queuedDatabase([target]), {
      events: [
        {
          ...storedEvent('wayfinder-launching', 'opportunity-0'),
          type: 'wayfinder-launching',
          admission: 'automatic',
        },
        unknown,
      ],
    })
    const database = memoryAutomationDatabase(interrupted, {
      failAppend: (batch) =>
        batch.events.some((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
    })
    const current = await harness({
      projects: [sourceProject],
      launcher: deferredLauncher().launcher,
      database,
      configuration: configuration([sourceProject], { enabledProjects: [] }),
    })

    const enabled = await current.application.execute({
      type: 'set-project-automation-enabled',
      expectedConfigurationVersion: 1,
      project: sourceProject.key,
      enabled: true,
    })

    expect(enabled).toMatchObject({ ok: false, error: { code: 'persistence-failed' } })
    expect(current.configured.writes).toEqual([])
    expect(current.application.current().automation.enabledProjects).toEqual([])
    await current.application.stop()
  })

  it('keeps queued work stopped when Project re-enable persistence fails after acknowledgement', async () => {
    const sourceProject = project('config-failure', [ticket('1'), ticket('2')])
    const targets = ['1', '2'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: 'map',
      ticketId,
    }))
    const unknown = {
      ...storedEvent('unknown', 'opportunity-0'),
      type: 'wayfinder-outcome-unknown',
      reason: 'Roadmap stopped.',
    } satisfies AutomationEvent
    const database = memoryAutomationDatabase(
      appendAutomationDatabase(queuedDatabase(targets), {
        events: [
          {
            ...storedEvent('wayfinder-launching', 'opportunity-0'),
            type: 'wayfinder-launching',
            admission: 'automatic',
          },
          unknown,
        ],
      }),
    )
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database,
      configuration: configuration([sourceProject], { enabledProjects: [] }),
      configurationWriteResult: { ok: false, kind: 'persistence', message: 'Disk is read-only.' },
    })

    const enabled = await current.application.execute({
      type: 'set-project-automation-enabled',
      expectedConfigurationVersion: 1,
      project: sourceProject.key,
      enabled: true,
    })

    expect(enabled).toMatchObject({ ok: false, error: { code: 'persistence-failed' } })
    expect(
      database.events().find((event) => event.type === 'wayfinder-outcome-unknown-acknowledged'),
    ).toMatchObject({ unknownEventId: unknown.id })
    expect(launches.dispatches).toEqual([])
    expect(current.application.current().automation.enabledProjects).toEqual([])
    await current.application.stop()
  })

  it('runs one Wayfinder Session per Project and releases the lane on completion', async () => {
    const sourceProject = project('serialized', [ticket('1'), ticket('2')])
    const targets = ['1', '2'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: 'map',
      ticketId,
    }))
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: memoryAutomationDatabase(queuedDatabase(targets)),
    })

    expect(launches.sessions).toHaveLength(1)
    expect(
      current.application
        .current()
        .automation.overrides.find((control) => control.target.ticketId === '2')?.wayfinder,
    ).toEqual({
      status: 'ineligible',
      reason: 'Another Wayfinder Session is in progress for this Project.',
    })

    launches.sessions[0]?.resolve(wayfinderResult())
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(2))
    expect(
      current.application
        .current()
        .automation.evidence.find((evidence) => evidence.target.ticketId === '2')?.wayfinder,
    ).toMatchObject({ status: 'running' })

    launches.sessions[1]?.resolve(wayfinderResult())
    await vi.waitFor(() =>
      expect(
        current.application.current().automation.evidence.map((evidence) => evidence.wayfinder),
      ).toEqual([
        expect.objectContaining({ status: 'finished' }),
        expect.objectContaining({ status: 'finished' }),
      ]),
    )
    await current.application.stop()
  })

  it('runs Wayfinder Sessions for different Projects concurrently', async () => {
    const projects = [project('one', [ticket('1')]), project('two', [ticket('2')])]
    const targets = projects.map((entry, index) => ({
      project: entry.key,
      mapId: 'map',
      ticketId: String(index + 1),
    }))
    const launches = deferredLauncher()
    const current = await harness({
      projects,
      launcher: launches.launcher,
      database: memoryAutomationDatabase(queuedDatabase(targets)),
    })

    expect(launches.sessions).toHaveLength(2)
    await vi.waitFor(() =>
      expect(
        current.application.current().automation.evidence.map((evidence) => evidence.wayfinder),
      ).toEqual([
        expect.objectContaining({ status: 'running' }),
        expect.objectContaining({ status: 'running' }),
      ]),
    )

    for (const session of launches.sessions) session.resolve(wayfinderResult())
    await current.application.stop()
  })

  it('retains a disabled queued Session and revalidates it on configuration and snapshots', async () => {
    const sourceProject = project('gated', [ticket('1')])
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
    const launches = deferredLauncher()
    const disabled = configuration([sourceProject], { enabledProjects: [] })
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: memoryAutomationDatabase(queuedDatabase([target])),
      configuration: disabled,
    })

    expect(launches.sessions).toHaveLength(0)
    expect(current.database.events().map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
    ])

    current.source.push([
      project('gated', [ticket('1', TASK, { state: 'claimed', isClaimed: true })]),
    ])
    current.configured.emit({
      ...disabled,
      configurationVersion: 2,
      automation: { ...disabled.automation, enabledProjects: [sourceProject.key] },
    })
    await vi.waitFor(() => expect(current.application.current().configurationVersion).toBe(2))
    await delay(10)
    expect(launches.sessions).toHaveLength(0)
    expect(current.database.events().map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
    ])

    current.source.push([sourceProject])
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))
    launches.sessions[0]?.resolve(wayfinderResult())
    await current.application.stop()
  })

  it('renders configured map and ticket pointers for both Harness Commands', async () => {
    const mapUrl = 'https://github.com/example/project/issues/1'
    const ticketUrl = 'https://github.com/example/project/issues/2'
    const sourceTicket = ticket('2', TASK, { url: ticketUrl })
    const sourceProject = project('github-pointers', [sourceTicket])
    sourceProject.openMaps[0] = map(sourceProject.key, [sourceTicket], { url: mapUrl })
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: configuration([sourceProject], {
        classificationCommand: {
          ...COMMAND,
          promptTemplate:
            'Classify {{roadmap.ticket}} under {{roadmap.map}}. Contract: {{roadmap.classificationResultSchema}}',
        },
        wayfinderCommand: {
          ...COMMAND,
          promptTemplate:
            'Run {{roadmap.map}} ticket {{roadmap.ticket}}. Contract: {{roadmap.sessionReportSchema}}',
        },
      }),
    })
    expect(launches.classifications[0]?.request.prompt).toBe(
      `Classify ${ticketUrl} under ${mapUrl}. Contract: ${classificationResultSchemaJson}`,
    )
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    expect(launches.dispatches[0]?.prompt).toBe(
      `Run ${mapUrl} ticket ${ticketUrl}. Contract: ${sessionReportSchemaJson}`,
    )
    await current.application.stop()
  })

  it('persists each attempt before launch and never repeats the same ticket identity', async () => {
    const sourceProject = project('one', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher({
      beforeClassify() {
        expect(database.evidence()).toEqual([
          expect.objectContaining({
            classification: { status: 'running', admission: 'automatic' },
          }),
        ])
        expect(database.events().map((event) => event.type)).toEqual(['classification-started'])
      },
      beforeDispatch() {
        expect(database.evidence()[0]?.wayfinder).toEqual({
          status: 'launching',
          admission: 'automatic',
        })
        expect(database.events().map((event) => event.type)).toEqual([
          'classification-started',
          'classification-completed',
          'wayfinder-launching',
        ])
      },
    })
    const first = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })

    expect(launches.classifications).toHaveLength(1)
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toEqual({
        status: 'running',
        admission: 'automatic',
      }),
    )
    expect(database.events().map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
      'wayfinder-launching',
      'wayfinder-running',
    ])

    first.source.push([project('one', [ticket('1', TASK, { body: 'Edited body.' })])])
    first.source.push([project('one', [])])
    first.source.push([project('one', [ticket('1')])])
    first.configured.emit({
      ...configuration([sourceProject]),
      configurationVersion: 2,
      automation: {
        ...configuration([sourceProject]).automation,
        classificationCommand: { ...COMMAND, args: ['-e', 'process.exit(0)'] },
      },
    })
    await delay(20)
    expect(launches.classifications).toHaveLength(1)
    expect(launches.dispatches).toHaveLength(1)
    await first.application.stop()

    const restartedLaunches = deferredLauncher()
    const restarted = await harness({
      projects: [sourceProject],
      launcher: restartedLaunches.launcher,
      database: database,
    })
    expect(restartedLaunches.classifications).toHaveLength(0)
    expect(restartedLaunches.dispatches).toHaveLength(0)
    expect(database.events().map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
      'wayfinder-launching',
      'wayfinder-running',
      'wayfinder-outcome-unknown',
    ])
    await restarted.application.stop()
  })

  it('inspects current frontier immediately when Automation becomes enabled', async () => {
    const sourceProject = project('one', [ticket('1')])
    const disabled = configuration([sourceProject], { enabled: false })
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: disabled,
    })
    expect(launches.classifications).toHaveLength(0)

    current.configured.emit({
      ...disabled,
      configurationVersion: 2,
      automation: { ...disabled.automation, enabled: true },
    })

    await vi.waitFor(() => expect(launches.classifications).toHaveLength(1))
    await current.application.stop()
  })
  it('runs each eligible stage once without changing Automation enablement', async () => {
    const sourceProject = project('override', [ticket('1'), ticket('2')])
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: configuration([sourceProject], { enabled: false, enabledProjects: [] }),
    })
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }

    expect(current.application.current().automation.overrides).toContainEqual({
      target,
      classification: { status: 'eligible' },
      wayfinder: { status: 'ineligible', reason: 'Run Classification first.' },
    })
    const classification = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target,
      stage: 'classification',
    })
    expect(classification).toMatchObject({
      ok: true,
      result: { type: 'automation-override-started', target, stage: 'classification' },
      state: { automation: { enabled: false, enabledProjects: [] } },
    })
    expect(launches.classifications).toHaveLength(1)
    expect(current.database.evidence()[0]?.classification).toEqual({
      status: 'running',
      admission: 'override',
    })
    expect(
      current.application
        .current()
        .automation.overrides.find((control) => control.target.ticketId === '2')?.classification,
    ).toEqual({ status: 'ineligible', reason: 'Another Classification Run is in progress.' })

    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() =>
      expect(current.application.current().automation.overrides[0]?.wayfinder).toEqual({
        status: 'eligible',
      }),
    )
    expect(launches.dispatches).toHaveLength(0)
    expect(current.application.current().automation.overrides[0]?.classification).toEqual({
      status: 'ineligible',
      reason: 'This Automation opportunity has already been classified.',
    })

    const wayfinder = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target,
      stage: 'wayfinder',
    })
    expect(wayfinder).toMatchObject({
      ok: true,
      result: { type: 'automation-override-started', target, stage: 'wayfinder' },
    })
    await vi.waitFor(() =>
      expect(current.database.evidence()[0]?.wayfinder).toEqual({
        status: 'running',
        admission: 'override',
      }),
    )
    expect(launches.dispatches).toHaveLength(1)
    expect(current.application.current().automation.overrides[0]?.wayfinder).toEqual({
      status: 'ineligible',
      reason: 'A Wayfinder Session is already recorded for this opportunity.',
    })

    launches.sessions[0]?.resolve(wayfinderResult())
    await current.application.stop()
  })

  it('keeps automatic handoff gated by effective enablement after an override Classification', async () => {
    const sourceProject = project('override-handoff', [ticket('1')])
    const launches = deferredLauncher()
    const disabled = configuration([sourceProject], { enabled: false, enabledProjects: [] })
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      configuration: disabled,
    })
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }

    await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target,
      stage: 'classification',
    })
    current.configured.emit({
      ...disabled,
      configurationVersion: 2,
      automation: { ...disabled.automation, enabled: true, enabledProjects: [sourceProject.key] },
    })
    launches.classifications[0]?.resolve(processResult())

    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    await vi.waitFor(() =>
      expect(current.database.evidence()[0]?.wayfinder).toEqual({
        status: 'running',
        admission: 'automatic',
      }),
    )
    launches.sessions[0]?.resolve(wayfinderResult())
    await current.application.stop()
  })
  it('requires an AFK Verdict before a Wayfinder override', async () => {
    const sourceProject = project('override-hitl', [ticket('1')])
    const target = { project: sourceProject.key, mapId: 'map', ticketId: '1' }
    const database = memoryAutomationDatabase({
      schemaVersion: 3,
      opportunities: [{ id: 'opportunity', target }],
      events: [
        {
          ...storedEvent('classification-started'),
          type: 'classification-started',
          admission: 'override',
        },
        {
          ...storedEvent('classification-completed'),
          type: 'classification-completed',
          processResult: { status: 'exited', code: 0 },
          verdict: { value: 'hitl', reason: 'Human judgment is required.' },
        },
      ],
    })
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
      configuration: configuration([sourceProject], { enabled: false, enabledProjects: [] }),
    })

    expect(current.application.current().automation.overrides[0]?.wayfinder).toEqual({
      status: 'ineligible',
      reason: 'Classification did not produce an AFK Verdict.',
    })
    const rejected = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target,
      stage: 'wayfinder',
    })
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Classification did not produce an AFK Verdict.' },
    })
    expect(launches.dispatches).toHaveLength(0)
    await current.application.stop()
  })

  it('explains and enforces task, source, blocker, claim, and opportunity uniqueness', async () => {
    const sourceProject = project('override-eligibility', [
      ticket('research', { kind: 'recognized', value: 'research', labels: ['research'] }),
      ticket('incomplete', TASK, { blockersComplete: false }),
      ticket('blocked', TASK, { state: 'blocked', isBlocked: true }),
      ticket('claimed', TASK, { state: 'claimed', isClaimed: true }),
      ticket('closed', TASK, { state: 'closed' }),
    ])
    const incompleteMapProject = project('override-map-incomplete', [ticket('map-incomplete')])
    const incompleteMap = incompleteMapProject.openMaps[0]
    if (incompleteMap) incompleteMap.ticketsComplete = false
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject, incompleteMapProject],
      launcher: launches.launcher,
      configuration: configuration([sourceProject, incompleteMapProject], {
        enabled: false,
        enabledProjects: [],
      }),
    })
    const controls = new Map(
      current.application
        .current()
        .automation.overrides.map((control) => [control.target.ticketId, control.classification]),
    )

    expect(controls).toEqual(
      new Map([
        ['research', { status: 'ineligible', reason: 'Only task tickets can use Automation.' }],
        ['incomplete', { status: 'ineligible', reason: 'Ticket blocker data is incomplete.' }],
        ['blocked', { status: 'ineligible', reason: 'Ticket is blocked.' }],
        ['claimed', { status: 'ineligible', reason: 'Ticket is already claimed.' }],
        ['closed', { status: 'ineligible', reason: 'Ticket is already decided.' }],
        [
          'map-incomplete',
          { status: 'ineligible', reason: 'The active map’s ticket list is incomplete.' },
        ],
      ]),
    )
    const rejected = await current.application.execute({
      type: 'start-automation-override',
      expectedConfigurationVersion: 1,
      target: { project: sourceProject.key, mapId: 'map', ticketId: 'claimed' },
      stage: 'classification',
    })
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Ticket is already claimed.' },
    })
    expect(launches.classifications).toHaveLength(0)
    await current.application.stop()
  })

  it('fails closed for missing commands, non-task types, and incomplete source facts', async () => {
    const research = project('research', [
      ticket('1', { kind: 'recognized', value: 'research', labels: ['research'] }),
    ])
    const conflicting = project('conflicting', [
      ticket('2', { kind: 'conflicting', labels: ['research', 'task'] }),
    ])
    const incompleteTickets = project('tickets', [ticket('3')])
    incompleteTickets.openMaps[0] = map(
      incompleteTickets.key,
      incompleteTickets.openMaps[0]?.tickets ?? [],
      {
        ticketsComplete: false,
      },
    )
    const incompleteBlockers = project('blockers', [ticket('4', TASK, { blockersComplete: false })])
    const projects = [research, conflicting, incompleteTickets, incompleteBlockers]
    const launches = deferredLauncher()
    const current = await harness({ projects, launcher: launches.launcher })

    expect(launches.classifications).toHaveLength(0)
    await current.application.stop()

    const taskProject = project('missing-command', [ticket('5')])
    const missingCommand = await harness({
      projects: [taskProject],
      launcher: launches.launcher,
      configuration: configuration([taskProject], { wayfinderCommand: undefined }),
    })
    expect(launches.classifications).toHaveLength(0)
    await missingCommand.application.stop()
  })

  it.each([
    [
      'hitl',
      processResult({
        stdout: JSON.stringify({ schemaVersion: 1, verdict: 'hitl', reason: 'Human.' }),
      }),
    ],
    [
      'unable',
      processResult({
        stdout: JSON.stringify({ schemaVersion: 1, verdict: 'unable', reason: 'Unknown.' }),
      }),
    ],
    ['malformed output', processResult({ stdout: '{bad-json' })],
    ['nonzero exit', processResult({ code: 7 })],
    [
      'launch failure',
      {
        status: 'launch-failed',
        reason: 'The command was not found.',
      } satisfies ClassificationProcessResult,
    ],
  ])('records %s as terminal without dispatch or retry', async (_name, result) => {
    const sourceProject = project('one', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.resolve(result)

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.classification.status).not.toBe('running'),
    )
    expect(launches.dispatches).toHaveLength(0)
    current.source.push([sourceProject])
    await delay(10)
    expect(launches.classifications).toHaveLength(1)
    await current.application.stop()
  })

  it('treats a lost Classification process as terminal', async () => {
    const sourceProject = project('one', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.reject(new Error('lost'))

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.classification.status).toBe('outcome-unknown'),
    )
    expect(launches.dispatches).toHaveLength(0)
    await current.application.stop()
  })

  it('records a failed session launch before moving to the next classifier', async () => {
    const projects = [project('one', [ticket('1')]), project('two', [ticket('2')])]
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher({ dispatchError: new Error('missing') })
    const current = await harness({ projects, launcher: launches.launcher, database })
    launches.classifications[0]?.resolve(processResult())

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toMatchObject({
        status: 'launch-failed',
        admission: 'automatic',
      }),
    )
    await vi.waitFor(() => expect(launches.classifications).toHaveLength(2))
    expect(launches.maximumRunning()).toBe(1)
    await current.application.stop()
  })

  it('persists independent Process result and Session report facts on completion', async () => {
    const sourceProject = project('one', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))
    await vi.waitFor(() => expect(database.evidence()[0]?.wayfinder?.status).toBe('running'))

    launches.sessions[0]?.resolve(wayfinderResult({ code: 7 }))

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toEqual({
        status: 'finished',
        admission: 'automatic',
        processResult: { status: 'exited', code: 7 },
        report: {
          status: 'received',
          report: { outcome: 'completed', reason: 'Ticket resolved.' },
        },
      }),
    )
    await current.application.stop()
  })

  it.each([
    [
      'missing',
      'missing',
      wayfinderResult({ stdout: '' }),
      'The Wayfinder Session produced no Session report.',
    ],
    [
      'invalid',
      'invalid',
      wayfinderResult({ stdout: '{bad-json' }),
      'Wayfinder Session stdout did not match the current report contract.',
    ],
    [
      'oversized',
      'invalid',
      wayfinderResult({ stdout: '{}', stdoutOversized: true }),
      'Wayfinder Session stdout exceeded 16384 bytes.',
    ],
  ])('records %s Session report evidence', async (_name, status, result, reason) => {
    const sourceProject = project(`report-${_name}`, [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))

    launches.sessions[0]?.resolve(result)

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toMatchObject({
        status: 'finished',
        processResult: { status: 'exited', code: 0 },
        report: { status, reason },
      }),
    )
    await current.application.stop()
  })

  it('records a lost Wayfinder process as outcome unknown', async () => {
    const sourceProject = project('lost-session', [ticket('1')])
    const database = memoryAutomationDatabase()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      database: database,
    })
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.sessions).toHaveLength(1))
    await vi.waitFor(() => expect(database.evidence()[0]?.wayfinder?.status).toBe('running'))

    launches.sessions[0]?.reject(new Error('lost'))

    await vi.waitFor(() =>
      expect(database.evidence()[0]?.wayfinder).toMatchObject({
        status: 'outcome-unknown',
        reason: expect.stringContaining('process result was lost'),
      }),
    )
    await vi.waitFor(() =>
      expect(current.application.current().automation.enabledProjects).toEqual([]),
    )
    await current.application.stop()
  })

  it('allows only one global classifier at a time', async () => {
    const projects = [project('one', [ticket('1')]), project('two', [ticket('2')])]
    const launches = deferredLauncher()
    const current = await harness({ projects, launcher: launches.launcher })
    expect(launches.classifications).toHaveLength(1)
    expect(launches.maximumRunning()).toBe(1)

    launches.classifications[0]?.resolve(
      processResult({
        stdout: JSON.stringify({ schemaVersion: 1, verdict: 'hitl', reason: 'Human.' }),
      }),
    )
    await vi.waitFor(() => expect(launches.classifications).toHaveLength(2))
    expect(launches.maximumRunning()).toBe(1)
    await current.application.stop()
  })

  it('direct-spawns the classifier and detaches a Wayfinder session in the Workspace', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'roadmap-automation-'))
    roots.push(temporaryRoot)
    const root = await realpath(temporaryRoot)
    const outputPath = join(root, 'session.json')
    const classifier: HarnessCommand = {
      command: process.execPath,
      args: [
        '-e',
        `process.stdin.resume(); process.stdout.write(JSON.stringify({schemaVersion:1, verdict:'afk', reason:'Ready.'}))`,
      ],
      promptDelivery: 'stdin',
      promptTemplate:
        'Classify {{roadmap.ticket}} for {{roadmap.map}} with {{roadmap.classificationResultSchema}}.',
    }
    const wayfinder: HarnessCommand = {
      command: process.execPath,
      args: [
        '-e',
        `let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => input += value); process.stdin.on('end', () => { require('node:fs').writeFileSync(process.argv[1], JSON.stringify({cwd:process.cwd(), input, kind:process.env.ROADMAP_RUN_KIND, map:process.env.ROADMAP_MAP_ID, ticket:process.env.ROADMAP_TICKET_ID})); process.stdout.write(JSON.stringify({schemaVersion:1, outcome:'completed', reason:'Ticket resolved.'})) })`,
        outputPath,
      ],
      promptDelivery: 'stdin',
      promptTemplate:
        'Configured map={{roadmap.map}} ticket={{roadmap.ticket}} report={{roadmap.sessionReportSchema}}',
    }
    const sourceProject = project('real', [ticket('9')])
    sourceProject.openMaps[0] = map(sourceProject.key, sourceProject.openMaps[0]?.tickets ?? [], {
      sourcePath: join(root, '.wayfinder/map.md'),
    })
    const configured = configuration([sourceProject], {
      classificationCommand: classifier,
      wayfinderCommand: wayfinder,
    })
    configured.projects[0] = {
      key: sourceProject.key,
      connectionId: 'local',
      locator: { integration: 'local', path: root },
      workspace: { path: root },
    }
    const current = await harness({
      projects: [sourceProject],
      launcher: createAutomationLauncher({ stopGraceMs: 10 }),
      configuration: configured,
    })

    let observed = ''
    await vi.waitFor(async () => {
      observed = await readFile(outputPath, 'utf8')
      expect(observed).not.toBe('')
    })
    const session: unknown = JSON.parse(observed)
    expect(session).toMatchObject({ cwd: root, kind: 'wayfinder', map: 'map', ticket: '9' })
    expect(isRecord(session) && session.input).toBe(
      `Configured map=${join(root, '.wayfinder/map.md')} ticket=/tmp/project-9/.wayfinder/tickets/9.md report=${sessionReportSchemaJson}`,
    )
    await vi.waitFor(() =>
      expect(current.database.evidence()[0]?.wayfinder).toEqual({
        status: 'finished',
        admission: 'automatic',
        processResult: { status: 'exited', code: 0 },
        report: {
          status: 'received',
          report: { outcome: 'completed', reason: 'Ticket resolved.' },
        },
      }),
    )
    await current.application.stop()
  })

  it('advances two queued Sessions for one Project in series with the configured launcher', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'roadmap-automation-series-'))
    roots.push(temporaryRoot)
    const root = await realpath(temporaryRoot)
    const lifecyclePath = join(root, 'sessions.log')
    const lockPath = join(root, 'session.lock')
    const wayfinder: HarnessCommand = {
      command: process.execPath,
      args: [
        '-e',
        `const fs=require('node:fs'); const ticket=process.env.ROADMAP_TICKET_ID; let lock; try { lock=fs.openSync(process.argv[2], 'wx'); } catch { fs.appendFileSync(process.argv[1], 'overlap:'+ticket+'\\n'); } fs.appendFileSync(process.argv[1], 'started:'+ticket+'\\n'); setTimeout(() => { fs.appendFileSync(process.argv[1], 'finished:'+ticket+'\\n'); if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(process.argv[2]); } process.stdout.write(JSON.stringify({schemaVersion:1, outcome:'completed', reason:'Ticket '+ticket+' resolved.'})); }, 100);`,
        lifecyclePath,
        lockPath,
      ],
      promptDelivery: 'stdin',
      promptTemplate: 'Run {{roadmap.ticket}} under {{roadmap.map}}.',
    }
    const sourceProject = project('series', [ticket('1'), ticket('2')])
    sourceProject.openMaps[0] = map(sourceProject.key, sourceProject.openMaps[0]?.tickets ?? [], {
      sourcePath: join(root, '.wayfinder/map.md'),
    })
    const configured = configuration([sourceProject], { wayfinderCommand: wayfinder })
    configured.projects[0] = {
      key: sourceProject.key,
      connectionId: 'local',
      locator: { integration: 'local', path: root },
      workspace: { path: root },
    }
    const targets = ['1', '2'].map((ticketId) => ({
      project: sourceProject.key,
      mapId: 'map',
      ticketId,
    }))
    const queued = queuedDatabase(targets)
    const databasePath = join(root, 'automation.json')
    const database = createAutomationDatabaseDocument(databasePath)
    await database.load()
    await database.append({ opportunities: queued.opportunities, events: queued.events })
    const source = adapter([sourceProject])
    const configuredDocument = memoryConfiguration(configured)
    const application = createRoadmapApplication({
      configuration: configuredDocument.document,
      automation: {
        database,
        launcher: createAutomationLauncher({ stopGraceMs: 10 }),
      },
      createAdapters: () => [source.value],
      serverEpoch: 'automation-series-test',
    })

    await application.start()

    await vi.waitFor(
      async () =>
        expect(await readFile(lifecyclePath, 'utf8')).toBe(
          'started:1\nfinished:1\nstarted:2\nfinished:2\n',
        ),
      { timeout: 5_000 },
    )
    await vi.waitFor(() =>
      expect(application.current().automation.evidence.map((entry) => entry.wayfinder)).toEqual([
        expect.objectContaining({ status: 'finished' }),
        expect.objectContaining({ status: 'finished' }),
      ]),
    )
    await application.stop()

    const stored = await createAutomationDatabaseDocument(databasePath).load()
    expect(stored.events.map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
      'classification-started',
      'classification-completed',
      'wayfinder-launching',
      'wayfinder-running',
      'wayfinder-finished',
      'wayfinder-launching',
      'wayfinder-running',
      'wayfinder-finished',
    ])
  })
})
