import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
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
  type AutomationDocument,
  type AutomationLaunch,
  type AutomationLauncher,
  type AutomationLedgerRecord,
  type ClassificationProcessResult,
  createAutomationLauncher,
} from './automation.ts'
import type {
  ConfigurationDocument,
  ConfigurationRead,
  ConfigurationWrite,
  HarnessCommand,
  RoadmapConfiguration,
} from './configuration.ts'

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

function memoryConfiguration(initial: RoadmapConfiguration) {
  let current = initial
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: current }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(): Promise<ConfigurationWrite> {
      return { ok: true }
    },
    async stop() {},
  }
  return {
    document,
    emit(next: RoadmapConfiguration) {
      current = next
      for (const listener of listeners) listener({ ok: true, document: next })
    },
  }
}

interface MemoryAutomationDocument {
  document: AutomationDocument
  records(): AutomationLedgerRecord[]
  writes: AutomationLedgerRecord[][]
}

function memoryAutomationDocument(
  initial: AutomationLedgerRecord[] = [],
): MemoryAutomationDocument {
  let records = [...initial]
  const writes: AutomationLedgerRecord[][] = []
  const document: AutomationDocument = {
    async load() {
      return records
    },
    async write(next) {
      records = [...next]
      writes.push(records)
    },
  }
  return { document, records: () => records, writes }
}

function adapter(initial: Project[]) {
  let host: AdapterHost | null = null
  const value: WayfinderAdapter = {
    type: 'local',
    start(nextHost) {
      host = nextHost
      host.update({ projects: initial, unreachable: [] })
    },
    stop() {},
  }
  return {
    value,
    push(projects: Project[]) {
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
  overrides: Partial<ClassificationProcessResult> = {},
): ClassificationProcessResult {
  return {
    code: 0,
    signal: null,
    stdout: JSON.stringify({ schemaVersion: 1, verdict: 'afk', reason: 'Agent-ready.' }),
    stdoutOversized: false,
    ...overrides,
  }
}

function deferredLauncher(
  options: {
    beforeClassify?: (request: AutomationLaunch) => void
    beforeDispatch?: (request: AutomationLaunch) => void
    dispatchError?: Error
  } = {},
) {
  const classifications: Array<{
    request: AutomationLaunch
    resolve(result: ClassificationProcessResult): void
    reject(error: Error): void
    stopped: boolean
  }> = []
  const dispatches: AutomationLaunch[] = []
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
    },
  }
  return { launcher, classifications, dispatches, maximumRunning: () => maximumRunning }
}

async function harness(options: {
  projects: Project[]
  launcher: AutomationLauncher
  document?: MemoryAutomationDocument
  configuration?: RoadmapConfiguration
}) {
  const source = adapter(options.projects)
  const ledger = options.document ?? memoryAutomationDocument()
  const configured = memoryConfiguration(options.configuration ?? configuration(options.projects))
  const application = createRoadmapApplication({
    configuration: configured.document,
    automation: { document: ledger.document, launcher: options.launcher },
    createAdapters: () => [source.value],
    serverEpoch: 'automation-test',
  })
  await application.start()
  return { application, source, ledger, configured }
}

describe('RoadmapApplication Automation', () => {
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
          promptTemplate: 'Classify {{roadmap.ticket}} under {{roadmap.map}}.',
        },
        wayfinderCommand: {
          ...COMMAND,
          promptTemplate: 'Run {{roadmap.map}} ticket {{roadmap.ticket}}.',
        },
      }),
    })

    expect(launches.classifications[0]?.request.prompt).toBe(
      `Classify ${ticketUrl} under ${mapUrl}.`,
    )
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    expect(launches.dispatches[0]?.prompt).toBe(`Run ${mapUrl} ticket ${ticketUrl}.`)
    await current.application.stop()
  })

  it('persists each attempt before launch and never repeats the same ticket identity', async () => {
    const sourceProject = project('one', [ticket('1')])
    const ledger = memoryAutomationDocument()
    const launches = deferredLauncher({
      beforeClassify() {
        expect(ledger.records()).toEqual([
          expect.objectContaining({ classification: { status: 'attempted' } }),
        ])
      },
      beforeDispatch() {
        expect(ledger.records()[0]?.wayfinder).toEqual({ status: 'attempted' })
      },
    })
    const first = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      document: ledger,
    })

    expect(launches.classifications).toHaveLength(1)
    launches.classifications[0]?.resolve(processResult())
    await vi.waitFor(() => expect(launches.dispatches).toHaveLength(1))
    await vi.waitFor(() => expect(ledger.records()[0]?.wayfinder).toEqual({ status: 'started' }))

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
      document: ledger,
    })
    expect(restartedLaunches.classifications).toHaveLength(0)
    expect(restartedLaunches.dispatches).toHaveLength(0)
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
    ['launch failure', processResult({ launchError: 'The command was not found.' })],
  ])('records %s as terminal without dispatch or retry', async (_name, result) => {
    const sourceProject = project('one', [ticket('1')])
    const ledger = memoryAutomationDocument()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      document: ledger,
    })
    launches.classifications[0]?.resolve(result)

    await vi.waitFor(() => expect(ledger.records()[0]?.classification.status).not.toBe('attempted'))
    expect(launches.dispatches).toHaveLength(0)
    current.source.push([sourceProject])
    await delay(10)
    expect(launches.classifications).toHaveLength(1)
    await current.application.stop()
  })

  it('treats a lost Classification process as terminal', async () => {
    const sourceProject = project('one', [ticket('1')])
    const ledger = memoryAutomationDocument()
    const launches = deferredLauncher()
    const current = await harness({
      projects: [sourceProject],
      launcher: launches.launcher,
      document: ledger,
    })
    launches.classifications[0]?.reject(new Error('lost'))

    await vi.waitFor(() => expect(ledger.records()[0]?.classification.status).toBe('failed'))
    expect(launches.dispatches).toHaveLength(0)
    await current.application.stop()
  })

  it('records a failed session launch before moving to the next classifier', async () => {
    const projects = [project('one', [ticket('1')]), project('two', [ticket('2')])]
    const ledger = memoryAutomationDocument()
    const launches = deferredLauncher({ dispatchError: new Error('missing') })
    const current = await harness({ projects, launcher: launches.launcher, document: ledger })
    launches.classifications[0]?.resolve(processResult())

    await vi.waitFor(() =>
      expect(ledger.records()[0]?.wayfinder).toEqual({ status: 'launch-failed' }),
    )
    await vi.waitFor(() => expect(launches.classifications).toHaveLength(2))
    expect(launches.maximumRunning()).toBe(1)
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
      promptTemplate: 'Classify {{roadmap.ticket}} for {{roadmap.map}}.',
    }
    const wayfinder: HarnessCommand = {
      command: process.execPath,
      args: [
        '-e',
        `let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => input += value); process.stdin.on('end', () => require('node:fs').writeFileSync(process.argv[1], JSON.stringify({cwd:process.cwd(), input, kind:process.env.ROADMAP_RUN_KIND, map:process.env.ROADMAP_MAP_ID, ticket:process.env.ROADMAP_TICKET_ID})))`,
        outputPath,
      ],
      promptDelivery: 'stdin',
      promptTemplate: 'Configured map={{roadmap.map}} ticket={{roadmap.ticket}}',
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
      `Configured map=${join(root, '.wayfinder/map.md')} ticket=/tmp/project-9/.wayfinder/tickets/9.md`,
    )
    await current.application.stop()
  })
})
