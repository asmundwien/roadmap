import { mkdir, mkdtemp, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandSchema } from '@roadmap/contracts/operations'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { decodeStateEnvelope } from '@roadmap/contracts/wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AutomationDatabase, appendAutomationDatabase } from '../automation/database.ts'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type {
  ObservationBatch,
  SourceProjectKey as ProjectKey,
  SourceContribution,
  SourceObserver,
} from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import {
  fixtureProjectRef,
  fixtureResourceRef,
  fixtureTicketRef,
  readApplicationState,
} from '../public-test-fixtures.ts'
import { readLocalProject } from '../wayfinder/from-local.ts'
import { createRoadmapApplication } from './application.ts'
import { createApplicationOperations } from './operations.ts'

const filesystem = vi.hoisted(() => ({
  failures: new Map<string, Error>(),
  calls: [] as string[],
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      const key = `enumerate:${String(args[0])}`
      filesystem.calls.push(key)
      const failure = filesystem.failures.get(key)
      return failure ? Promise.reject(failure) : actual.readdir(...args)
    },
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      const key = `read:${String(args[0])}`
      filesystem.calls.push(key)
      const failure = filesystem.failures.get(key)
      return failure ? Promise.reject(failure) : actual.readFile(...args)
    },
  }
})

const PROJECT: ProjectKey = { integration: 'local', id: 'same-time-local' }
const FIRST = '.wayfinder/first/map.md'
const SECOND = '.wayfinder/second/map.md'
const T = 1000
const SECRET = 'private fixed-clock filesystem detail'
const MAP_BODY =
  '## Destination\n\nSame-time map prose.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n'
const TICKET_BODY = 'Same-time ticket prose.'

function publicProject(state: ReadyApplicationState) {
  const project = state.projects.find((entry) => entry.ref.projectId === PROJECT.id)
  if (!project) throw new Error('The configured Local Project is missing')
  return project
}

function publicMap(state: ReadyApplicationState) {
  const map = publicProject(state).maps.find((entry) => entry.ref.mapId === FIRST)
  if (!map) throw new Error('The selected Local map lost its identity')
  return map
}

function publicTicket(state: ReadyApplicationState) {
  const ticket = publicMap(state).tickets.find((entry) => entry.ref.ticketId === '1')
  if (!ticket) throw new Error('The selected Local ticket lost its identity')
  return ticket
}

function outgoing(state: ReadyApplicationState) {
  const serialized = JSON.stringify({ type: 'state', state })
  expect(serialized).not.toContain('readSequence')
  expect(serialized).not.toContain('sourceBindings')
  const envelope: unknown = JSON.parse(serialized)
  const decoded = decodeStateEnvelope(envelope)
  expect(decoded.ok).toBe(true)
  if (!decoded.ok) throw new Error('The actual application publication failed consumer decoding')
  expect(JSON.stringify(decoded.value)).not.toContain(SECRET)
  expect(decoded.value.state.phase).toBe('ready')
  return readApplicationState(decoded.value.state)
}

function ownTicketRead(batch: ObservationBatch) {
  const attempt = batch.attempts.find(
    (entry) =>
      entry.scope.kind === 'ticket' &&
      entry.scope.ticket.map.mapId === FIRST &&
      entry.scope.ticket.ticketId === '1',
  )
  if (!attempt || attempt.kind !== 'observed' || attempt.scope.kind !== 'ticket')
    throw new Error('The actual Local reader did not successfully read the selected ticket')
  return attempt
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-same-time-read-')))
  let clock = T
  const batches: ObservationBatch[] = []
  const contributions: SourceContribution[] = []
  const publications: ReadyApplicationState[] = []
  const effects: string[] = []
  const listeners = new Set<(read: ConfigurationRead) => void>()
  const command = {
    command: process.execPath,
    args: [],
    promptDelivery: 'stdin',
    promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
  } satisfies NonNullable<ProjectConfiguration['automation']['classificationCommand']>
  let configured: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: [
      {
        ref: { integration: 'local', projectId: PROJECT.id },
        connectionId: 'local',
        workspace: { path: root },
      },
    ],
    automation: {
      enabled: false,
      enabledProjects: [PROJECT],
      classificationCommand: command,
      wayfinderCommand: command,
    },
  }
  let stored: AutomationDatabase = { schemaVersion: 3, opportunities: [], events: [] }
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: configured }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async write() {
      throw new Error('Source reads must not write configuration')
    },
    async stop() {},
  }
  const application = createRoadmapApplication({
    configuration: document,
    admissions: { local: createLocalProjectAdmission() },
    now: () => clock,
    operations: createApplicationOperations({
      host: {
        async execute(operation) {
          if (operation.type === 'select-workspace') return { kind: 'cancelled' }
          effects.push('host')
          return { kind: 'invoked' }
        },
      },
    }),
    observers: {
      local(input) {
        const actual = createLocalObserver(input, {
          now: () => clock,
          reconcileMs: 60_000_000,
          recoveryMs: 60_000_000,
          maxRecoveryMs: 60_000_000,
          watchDirectory: () => ({ close() {} }),
          logger: { info() {}, warn() {} },
          async readProject(readInput, options) {
            const batch = await readLocalProject(readInput, options)
            batches.push(batch)
            return batch
          },
        })
        const record = (value: SourceContribution) => {
          contributions.push(value)
          return value
        }
        return {
          async observe() {
            return record(await actual.observe())
          },
          subscribe(listener) {
            return actual.subscribe((value) => listener(record(value)))
          },
          async refresh() {
            return record(await actual.refresh())
          },
          stop: () => actual.stop(),
        } satisfies SourceObserver
      },
      github() {
        throw new Error('This fixture has only a Local source')
      },
    },
    automation: {
      database: {
        async load() {
          return stored
        },
        async append(batch) {
          stored = appendAutomationDatabase(stored, batch)
          return { database: stored, durability: 'confirmed' }
        },
      },
      launcher: {
        classify() {
          effects.push('classification')
          throw new Error('No real Classification is allowed')
        },
        async dispatch() {
          effects.push('wayfinder')
          throw new Error('No real Session is allowed')
        },
      },
    },
  })
  const unsubscribe = application.subscribe((state) => {
    if (state.phase === 'ready') publications.push(outgoing(readApplicationState(state)))
  })
  try {
    for (const [directory, modified] of [
      ['first', 900],
      ['second', 800],
    ] as const) {
      const path = join(root, '.wayfinder', directory)
      await mkdir(join(path, 'tickets'), { recursive: true })
      await writeFile(
        join(path, 'map.md'),
        `---\ntitle: ${directory} map\nlabels: [wayfinder:map]\nstatus: open\n---\n\n${MAP_BODY}`,
      )
      await writeFile(
        join(path, 'tickets/01-ticket.md'),
        `---\nid: 1\ntitle: ${directory} ticket\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: []\n---\n\n${TICKET_BODY}\n`,
      )
      for (const filename of ['map.md', 'tickets/01-ticket.md'])
        await utimes(join(path, filename), modified / 1000, modified / 1000)
    }
    await application.start()
    return {
      root,
      application,
      batches,
      contributions,
      publications,
      effects,
      latestBatch() {
        const batch = batches.at(-1)
        if (!batch) throw new Error('No actual Local reader invocation was recorded')
        return batch
      },
      async refresh(at = T, kind: 'observed' | 'degraded' = 'observed') {
        clock = at
        const outcome = await application.execute(
          commandSchema.parse({
            type: 'refresh-project',
            project: fixtureProjectRef(PROJECT),
            expectedConfigurationVersion: configured.configurationVersion,
          }),
        )
        expect(outcome).toMatchObject({
          operation: 'refresh-project',
          subject: { kind: 'project', project: fixtureProjectRef(PROJECT) },
          ok: true,
          result: {
            type: 'refresh-project',
            project: fixtureProjectRef(PROJECT),
            attempt: { kind, attemptedAt: at, observedAt: T },
          },
        })
        expect(outcome).not.toHaveProperty('state')
        expect(JSON.stringify(outcome)).not.toContain(SECRET)
        return outgoing(readApplicationState(application.current()))
      },
      async enable() {
        configured = {
          ...configured,
          configurationVersion: 2,
          automation: { ...configured.automation, enabled: true },
        }
        for (const listener of listeners) listener({ ok: true, document: configured })
        await vi.waitFor(() =>
          expect(readApplicationState(application.current()).configurationVersion).toBe(2),
        )
      },
      async stop() {
        filesystem.failures.clear()
        unsubscribe()
        await application.stop()
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    filesystem.failures.clear()
    unsubscribe()
    await application.stop()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

function baseline(state: ReadyApplicationState) {
  expect(publicProject(state)).toMatchObject({
    resource: {
      kind: 'current-readable',
      observation: { observedAt: T, completeness: { kind: 'complete' } },
    },
    mapsMembership: { kind: 'current-complete', observation: { observedAt: T } },
    displayOrder: {
      open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
      closed: [],
    },
    activeMap: {
      kind: 'known-current',
      ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
    },
  })
  expect(publicMap(state)).toMatchObject({
    resource: {
      kind: 'current-readable',
      observation: {
        observedAt: T,
        completeness: { kind: 'complete' },
        value: { body: { raw: MAP_BODY }, progress: { total: 1, completed: 0 } },
      },
    },
    ticketsMembership: { kind: 'current-complete', observation: { observedAt: T } },
  })
  expect(publicTicket(state)).toMatchObject({
    resource: {
      kind: 'current-readable',
      observation: {
        observedAt: T,
        completeness: { kind: 'complete' },
        value: { body: expect.stringContaining(TICKET_BODY), blockersComplete: true },
      },
    },
  })
}

afterEach(() => {
  filesystem.failures.clear()
  filesystem.calls.length = 0
})

describe('RoadmapApplication actual source read identity at one clock value', () => {
  // Catches payload/time equality treating a real child read as an inherited replay.
  it('keeps unchanged actual child reads current at T when the required map fails at T without authorizing order or admission', async () => {
    const test = await fixture()
    try {
      baseline(outgoing(readApplicationState(test.application.current())))
      const initial = ownTicketRead(test.latestBatch())
      expect(readApplicationState(test.application.current()).automation.overrides).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: fixtureTicketRef({ project: PROJECT, mapId: FIRST, ticketId: '1' }),
            classification: { status: 'eligible' },
          }),
        ]),
      )
      filesystem.calls.length = 0
      const mapPath = join(test.root, FIRST)
      const ticketPath = join(test.root, '.wayfinder/first/tickets/01-ticket.md')
      filesystem.failures.set(
        `read:${mapPath}`,
        Object.assign(new Error(SECRET), { code: 'EACCES' }),
      )
      const state = await test.refresh(T, 'degraded')
      const actualRead = ownTicketRead(test.latestBatch())
      expect(test.batches).toHaveLength(2)
      expect(actualRead).not.toBe(initial)
      expect(actualRead).toMatchObject({
        attemptedAt: T,
        observedAt: T,
        value: initial.value,
        provenance: initial.provenance,
      })
      expect(test.latestBatch().attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failed',
            scope: { kind: 'map', map: { project: PROJECT, mapId: FIRST } },
            attemptedAt: T,
            failure: { kind: 'filesystem', operation: 'read', code: 'EACCES' },
          }),
          expect.objectContaining({
            kind: 'observed',
            scope: { kind: 'tickets-membership', map: { project: PROJECT, mapId: FIRST } },
            observedAt: T,
            completeness: { kind: 'complete' },
          }),
        ]),
      )
      expect(filesystem.calls).toEqual(
        expect.arrayContaining([
          `read:${mapPath}`,
          `enumerate:${join(test.root, '.wayfinder/first/tickets')}`,
          `read:${ticketPath}`,
        ]),
      )
      expect(publicProject(state)).toMatchObject({
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
      })
      expect(publicMap(state).resource).toMatchObject({
        kind: 'retained-unavailable',
        lastSuccessful: { observedAt: T },
        unavailable: { attemptedAt: T, provenance: { path: mapPath, operation: 'read' } },
      })
      expect(publicTicket(state).resource).toMatchObject({
        kind: 'current-readable',
        observation: {
          attemptedAt: T,
          observedAt: T,
          provenance: { path: ticketPath, operation: 'read' },
          value: { body: expect.stringContaining(TICKET_BODY) },
        },
      })
      expect(publicMap(state).ticketsMembership).toMatchObject({
        kind: 'current-complete',
        observation: { observedAt: T },
      })
      expect(
        await test.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target: fixtureTicketRef({ project: PROJECT, mapId: FIRST, ticketId: '1' }),
            stage: 'classification',
          }),
        ),
      ).toMatchObject({ ok: false })
      await test.enable()
      expect(readApplicationState(test.application.current()).automation.evidence).toEqual([])
      expect(test.effects).toEqual([])
      outgoing(readApplicationState(test.application.current()))
    } finally {
      await test.stop()
    }
  })

  // Catches a strict timestamp gate rejecting real recovery after an equal-time proof.
  it.each(['map', 'ticket'] as const)(
    'restores actual same-identity %s reads and complete certainty after absence and recovery both at T',
    async (scope) => {
      const test = await fixture()
      try {
        baseline(outgoing(readApplicationState(test.application.current())))
        const path =
          scope === 'map'
            ? join(test.root, '.wayfinder/first')
            : join(test.root, '.wayfinder/first/tickets/01-ticket.md')
        const backup = join(test.root, `parked-${scope}`)
        await rename(path, backup)
        for (let repetition = 0; repetition < 2; repetition += 1) {
          const absentState = await test.refresh()
          const resource =
            scope === 'map' ? publicMap(absentState).resource : publicTicket(absentState).resource
          expect(resource).toMatchObject({
            kind: 'proven-absent',
            absence: { attemptedAt: T, observedAt: T, proof: { kind: 'complete-membership' } },
            trace: { kind: 'last-successful-trace', lastSuccessful: { observedAt: T } },
          })
          expect(test.contributions.at(-1)?.attempts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: 'proven-absent',
                scope: expect.objectContaining({ kind: scope }),
                observedAt: T,
              }),
            ]),
          )
          expect(publicProject(absentState)).toMatchObject({
            activeMap: {
              kind: 'known-current',
              ref: fixtureResourceRef({
                project: PROJECT,
                mapId: scope === 'map' ? SECOND : FIRST,
              }),
            },
            displayOrder: {
              open: (scope === 'map' ? [SECOND] : [FIRST, SECOND]).map((mapId) =>
                fixtureResourceRef({ project: PROJECT, mapId }),
              ),
            },
          })
        }
        await rename(backup, path)
        filesystem.calls.length = 0
        const recovered = await test.refresh()
        const actualRead = ownTicketRead(test.latestBatch())
        expect(actualRead).toMatchObject({
          attemptedAt: T,
          observedAt: T,
          provenance: {
            path: join(test.root, '.wayfinder/first/tickets/01-ticket.md'),
            operation: 'read',
          },
          value: { body: expect.stringContaining(TICKET_BODY) },
        })
        expect(filesystem.calls).toEqual(
          expect.arrayContaining([
            `read:${join(test.root, FIRST)}`,
            `read:${join(test.root, '.wayfinder/first/tickets/01-ticket.md')}`,
          ]),
        )
        baseline(recovered)
        expect(test.effects).toEqual([])
      } finally {
        await test.stop()
      }
    },
  )

  // Catches allocating child identity when only the ancestor was actually attempted.
  it('retains unchanged cached children through a newer root failure rather than counting publication as a read', async () => {
    const test = await fixture()
    try {
      baseline(outgoing(readApplicationState(test.application.current())))
      const initial = ownTicketRead(test.latestBatch())
      filesystem.calls.length = 0
      filesystem.failures.set(
        `enumerate:${test.root}`,
        Object.assign(new Error(SECRET), { code: 'EACCES' }),
      )
      const state = await test.refresh(2000, 'degraded')
      expect(test.latestBatch().attempts).toMatchObject([
        { kind: 'failed', scope: { kind: 'project', project: PROJECT }, attemptedAt: 2000 },
      ])
      expect(filesystem.calls).not.toContain(`read:${join(test.root, FIRST)}`)
      expect(filesystem.calls).not.toContain(
        `read:${join(test.root, '.wayfinder/first/tickets/01-ticket.md')}`,
      )
      expect(test.contributions.at(-1)?.attempts).toEqual(expect.arrayContaining([initial]))
      expect(publicTicket(state).resource).toMatchObject({
        kind: 'retained-unavailable',
        lastSuccessful: {
          observedAt: T,
          value: {
            body: expect.stringContaining(TICKET_BODY),
            title: 'first ticket',
            source: {
              kind: 'file',
              path: join(test.root, '.wayfinder/first/tickets/01-ticket.md'),
            },
          },
        },
        unavailable: {
          kind: 'source-failure',
          scope: { kind: 'project', project: fixtureProjectRef(PROJECT) },
          attemptedAt: 2000,
        },
      })
      expect(publicMap(state)).toMatchObject({
        resource: { kind: 'retained-unavailable', lastSuccessful: { observedAt: T } },
        ticketsMembership: { kind: 'unavailable', lastComplete: { observedAt: T } },
      })
      expect(publicProject(state)).toMatchObject({
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
      })
      expect(test.effects).toEqual([])
    } finally {
      await test.stop()
    }
  })
})
