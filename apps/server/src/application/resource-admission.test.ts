import { basename, join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { commandSchema } from '@roadmap/contracts/operations'
import type { Project } from '@roadmap/contracts/state'
import { describe, expect, it, vi } from 'vitest'
import {
  type AutomationDatabase,
  type AutomationDatabaseDocument,
  appendAutomationDatabase,
} from '../automation/database.ts'
import type {
  AutomationLaunch,
  AutomationLauncher,
  ClassificationProcessResult,
  WayfinderProcessResult,
} from '../automation/engine.ts'
import type { AutomationTarget } from '../automation/model.ts'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import type {
  ObservationAttempt,
  ObservationBatch,
  SourceObservationHealth,
} from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import {
  fixtureResourceRef,
  fixtureTicketRef,
  readApplicationState,
} from '../public-test-fixtures.ts'
import {
  controlledSourceFixture,
  createSourceFixtureOwner,
  type FixtureMap,
  type FixtureProject,
  type FixtureTicket,
  fixtureAdmissions,
} from '../source-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'

const PROJECT = { integration: 'local', id: 'retained-admission' } satisfies FixtureProject['key']
const ROOT = '/tmp/roadmap-retained-admission'
const TARGET: AutomationTarget = {
  project: PROJECT,
  mapId: '.wayfinder/first.md',
  ticketId: 'first',
}
const SECONDARY: AutomationTarget = {
  project: PROJECT,
  mapId: '.wayfinder/second.md',
  ticketId: 'second',
}

type Stage = 'classification' | 'wayfinder'
type Admission = 'automatic' | 'override'
type SourceChange =
  | 'root failure'
  | 'map directory failure'
  | 'map file failure'
  | 'ticket file failure'
  | 'omitted first map read'
  | 'map absence'
  | 'ticket absence'

function ticket(id: string, task = true): FixtureTicket {
  return {
    id,
    displayId: id,
    title: `Ticket ${id}`,
    body: `Keep the prose for ${id}.`,
    typeEvidence: {
      kind: 'recognized',
      value: task ? 'task' : 'research',
      labels: [task ? 'task' : 'research'],
    },
    state: 'frontier',
    isClaimed: false,
    isBlocked: false,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
    sourcePath: join(ROOT, '.wayfinder/tickets', `${id}.md`),
  }
}

function map(id: string, tickets: FixtureTicket[], updatedAt: number): FixtureMap {
  return {
    project: PROJECT,
    id,
    title: `Map ${basename(id)}`,
    isOpen: true,
    updatedAt,
    body: {
      raw: `# ${id}\n\nRetain this map's prose.`,
      destination: 'Admit only current source facts.',
      notes: [],
      decisions: [],
      notYetSpecified: [],
      notYetSpecifiedNote: '',
      outOfScope: [],
      sections: [],
      missingSections: [],
    },
    tickets,
    progress: { total: tickets.length, completed: 0 },
    ticketsComplete: true,
    warnings: [],
    sourcePath: join(ROOT, id),
  }
}

function content(secondaryTask = false): FixtureProject {
  return {
    key: PROJECT,
    name: 'Retained admission',
    sourcePath: ROOT,
    openMaps: [
      map(TARGET.mapId, [ticket('first')], 20),
      map(SECONDARY.mapId, [ticket('second', secondaryTask)], 10),
    ],
    closedMaps: [],
    warnings: [],
  }
}

function configuration(): ProjectConfiguration {
  const command = {
    command: process.execPath,
    args: [],
    promptDelivery: 'stdin' as const,
    promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
  }
  return {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: [
      {
        ref: { integration: 'local', projectId: PROJECT.id },
        connectionId: 'local',
        workspace: { path: ROOT },
      },
    ],
    automation: {
      enabled: false,
      enabledProjects: [PROJECT],
      classificationCommand: command,
      wayfinderCommand: command,
    },
  }
}

function queuedDatabase(): AutomationDatabase {
  const identity = { opportunityId: 'retained-opportunity', recordedAt: '2026-10-01T00:00:00.000Z' }
  return {
    schemaVersion: 3,
    opportunities: [{ id: identity.opportunityId, target: TARGET }],
    events: [
      {
        ...identity,
        id: 'classified-start',
        type: 'classification-started',
        admission: 'automatic',
      },
      {
        ...identity,
        id: 'classified-end',
        type: 'classification-completed',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'afk', reason: 'Agent-ready.' },
      },
    ],
  }
}

function changedBatch(
  project: FixtureProject,
  change: SourceChange,
  observedAt: number,
  read: ReturnType<typeof createSourceFixtureOwner>,
): ObservationBatch {
  if (change === 'map absence')
    return read(
      [{ ...project, openMaps: project.openMaps.filter((entry) => entry.id !== TARGET.mapId) }],
      observedAt,
    )
  if (change === 'ticket absence')
    return read(
      [
        {
          ...project,
          openMaps: project.openMaps.map((entry) =>
            entry.id === TARGET.mapId ? map(entry.id, [], entry.updatedAt) : entry,
          ),
        },
      ],
      observedAt,
    )
  const batch = read([project], observedAt)
  if (change === 'omitted first map read')
    return {
      attempts: batch.attempts.filter(
        (attempt) => attempt.scope.kind !== 'map' || attempt.scope.map.mapId !== TARGET.mapId,
      ),
    }
  const kind =
    change === 'root failure'
      ? 'project'
      : change === 'map directory failure'
        ? 'maps-membership'
        : change === 'map file failure'
          ? 'map'
          : 'ticket'
  const attempts = batch.attempts.flatMap((attempt): ObservationAttempt[] => {
    if (change === 'root failure' && attempt.scope.kind !== 'project') return []
    if (
      change === 'map directory failure' &&
      attempt.scope.kind !== 'project' &&
      attempt.scope.kind !== 'maps-membership'
    )
      return []
    if (
      attempt.scope.kind !== kind ||
      (attempt.scope.kind === 'map' && attempt.scope.map.mapId !== TARGET.mapId) ||
      (attempt.scope.kind === 'ticket' && attempt.scope.ticket.ticketId !== TARGET.ticketId)
    )
      return [attempt]
    const operation =
      kind === 'project' ? 'inspect-root' : kind === 'maps-membership' ? 'enumerate' : 'read'
    return [
      {
        kind: 'failed',
        readSequence: attempt.readSequence,
        scope: attempt.scope,
        attemptedAt: observedAt,
        provenance: attempt.provenance,
        failure: { kind: 'filesystem', operation, code: 'EACCES' },
      },
    ]
  })
  return { attempts }
}

async function harness(
  options: { stage?: Stage; holdAppend?: boolean; secondaryTask?: boolean } = {},
) {
  const project = content(options.secondaryTask)
  const read = createSourceFixtureOwner()
  const baseline = read([project], 1_000)
  const source = controlledSourceFixture(PROJECT, baseline)
  let configured = configuration()
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: configured }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next) {
      configured = next
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {},
  }
  let stored: AutomationDatabase =
    options.stage === 'wayfinder'
      ? queuedDatabase()
      : { schemaVersion: 3, opportunities: [], events: [] }
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const startType = options.stage === 'wayfinder' ? 'wayfinder-launching' : 'classification-started'
  let reservationEntered = false
  const database: AutomationDatabaseDocument = {
    async load() {
      return stored
    },
    async append(batch) {
      if (batch.events.some((event) => event.type === startType)) {
        reservationEntered = true
        entered.resolve()
        if (options.holdAppend) await release.promise
      }
      stored = appendAutomationDatabase(stored, batch)
      return { database: stored, durability: 'confirmed' }
    },
  }
  const classifications: AutomationLaunch[] = []
  const dispatches: AutomationLaunch[] = []
  const sessions: Array<ReturnType<typeof Promise.withResolvers<WayfinderProcessResult>>> = []
  const launcher: AutomationLauncher = {
    classify(request) {
      classifications.push(request)
      const completion = Promise.withResolvers<ClassificationProcessResult>()
      return {
        completed: completion.promise,
        async stop() {
          completion.resolve({
            status: 'outcome-unknown',
            reason: 'Harmless test process stopped.',
          })
        },
      }
    },
    async dispatch(request) {
      dispatches.push(request)
      const completion = Promise.withResolvers<WayfinderProcessResult>()
      sessions.push(completion)
      return { completed: completion.promise }
    },
  }
  const application = createRoadmapApplication({
    configuration: document,
    admissions: fixtureAdmissions,
    observers: {
      local: () => source.observer,
      github() {
        throw new Error('No GitHub source belongs to this fixture.')
      },
    },
    automation: { database, launcher },
    serverEpoch: 'resource-admission-test',
    now: () => 1_000,
  })
  async function stop() {
    release.resolve()
    const stopping = application.stop()
    for (const session of sessions)
      session.resolve({
        status: 'finished',
        code: null,
        signal: 'SIGTERM',
        stdout: '',
        stdoutOversized: false,
      })
    await stopping
  }
  try {
    await application.start()
    expect(readApplicationState(application.current()).automation.overrides).toContainEqual(
      expect.objectContaining({
        target: fixtureTicketRef(TARGET),
        [options.stage ?? 'classification']: { status: 'eligible' },
      }),
    )
  } catch (error) {
    await stop()
    throw error
  }
  return {
    application,
    source,
    project,
    baseline,
    read,
    changedBatch: (change: SourceChange, observedAt: number) =>
      changedBatch(project, change, observedAt, read),
    classifications,
    dispatches,
    async waitForReservation() {
      await vi.waitFor(() =>
        expect(reservationEntered, `Expected ${startType} append to be entered.`).toBe(true),
      )
      await entered.promise
    },
    release: () => release.resolve(),
    reservationEntered: () => reservationEntered,
    stop,
    events: () => stored.events,
    async enable() {
      configured = {
        ...configured,
        configurationVersion: configured.configurationVersion + 1,
        automation: { ...configured.automation, enabled: true },
      }
      for (const listener of listeners) listener({ ok: true, document: configured })
      await vi.waitFor(() =>
        expect(readApplicationState(application.current()).configurationVersion).toBe(
          configured.configurationVersion,
        ),
      )
    },
    override(stage: Stage, target = TARGET) {
      return application.execute(
        commandSchema.parse({
          type: 'start-automation-override',
          expectedConfigurationVersion: readApplicationState(application.current())
            .configurationVersion,
          target: fixtureTicketRef(target),
          stage,
        }),
      )
    },
  }
}

const SOURCE_CHANGES: SourceChange[] = [
  'root failure',
  'map directory failure',
  'map file failure',
  'ticket file failure',
  'omitted first map read',
  'map absence',
  'ticket absence',
]

function changeHealth(change: SourceChange, observedAt: number): SourceObservationHealth {
  if (change === 'map absence' || change === 'ticket absence')
    return { status: 'available', observedAt }
  return {
    status: 'degraded',
    cause: 'The selected resource is not current.',
    observedAt: change === 'root failure' ? 1_000 : observedAt,
  }
}

function selectedResource(project: Project | undefined, change: SourceChange) {
  const selectedMap = project?.maps.find((entry) => entry.ref.mapId === TARGET.mapId)
  if (!selectedMap) throw new Error('The selected map must remain addressable.')
  if (change !== 'ticket absence') return selectedMap.resource
  const selectedTicket = selectedMap.tickets.find((entry) => entry.ref.ticketId === TARGET.ticketId)
  if (!selectedTicket) throw new Error('The selected ticket must remain addressable.')
  return selectedTicket.resource
}

describe('RoadmapApplication retained resource admission', () => {
  for (const stage of ['classification', 'wayfinder'] satisfies Stage[]) {
    it.each(SOURCE_CHANGES)(
      `denies automatic and override ${stage} before append after %s`,
      async (change) => {
        const current = await harness({ stage })
        try {
          current.source.push(current.changedBatch(change, 2_000), changeHealth(change, 2_000))
          expect(await current.override(stage)).toMatchObject({ ok: false })
          await current.enable()
          await setImmediate()
          expect(current.classifications).toEqual([])
          expect(current.dispatches).toEqual([])
          expect(current.reservationEntered()).toBe(false)
          expect(
            current
              .events()
              .some(
                (event) =>
                  event.type ===
                  (stage === 'classification' ? 'classification-started' : 'wayfinder-launching'),
              ),
          ).toBe(false)
          if (stage === 'wayfinder')
            expect(
              readApplicationState(current.application.current()).automation.evidence,
            ).toContainEqual(
              expect.objectContaining({
                target: fixtureTicketRef(TARGET),
                classification: expect.objectContaining({
                  status: 'completed',
                  verdict: { value: 'afk', reason: 'Agent-ready.' },
                }),
                wayfinder: { status: 'queued' },
              }),
            )
          current.source.push(current.read([current.project], 3_000), {
            status: 'available',
            observedAt: 3_000,
          })
          await vi.waitFor(() =>
            expect(
              stage === 'classification' ? current.classifications : current.dispatches,
            ).toHaveLength(1),
          )
          const recoveredRequest = (
            stage === 'classification' ? current.classifications : current.dispatches
          )[0]
          expect(recoveredRequest?.environment).toMatchObject({
            ROADMAP_MAP_ID: TARGET.mapId,
            ROADMAP_TICKET_ID: TARGET.ticketId,
          })
          expect(
            readApplicationState(current.application.current()).automation.evidence[0]?.target,
          ).toEqual(fixtureTicketRef(TARGET))
        } finally {
          await current.stop()
        }
      },
    )

    for (const admission of ['automatic', 'override'] satisfies Admission[]) {
      it.each(SOURCE_CHANGES)(
        `records durable known nonlaunch for ${admission} ${stage} when %s commits during append`,
        async (change) => {
          const current = await harness({ stage, holdAppend: true })
          const startType =
            stage === 'classification' ? 'classification-started' : 'wayfinder-launching'
          const failureType =
            stage === 'classification' ? 'classification-launch-failed' : 'wayfinder-launch-failed'
          try {
            const pending = admission === 'override' ? current.override(stage) : null
            if (admission === 'automatic') await current.enable()
            await current.waitForReservation()
            expect(current.reservationEntered()).toBe(true)
            expect(current.events().some((event) => event.type === startType)).toBe(false)
            expect(current.classifications).toEqual([])
            expect(current.dispatches).toEqual([])
            current.source.push(current.changedBatch(change, 2_000), changeHealth(change, 2_000))
            current.release()
            if (pending) expect(await pending).toMatchObject({ ok: false })
            await vi.waitFor(() =>
              expect(current.events().filter((event) => event.type === failureType)).toHaveLength(
                1,
              ),
            )
            const reservations = current.events().filter((event) => event.type === startType)
            const nonlaunch = current.events().find((event) => event.type === failureType)
            expect(reservations).toHaveLength(1)
            expect(nonlaunch?.opportunityId).toBe(reservations[0]?.opportunityId)
            expect(
              readApplicationState(current.application.current()).automation.evidence,
            ).toContainEqual(
              expect.objectContaining({
                target: fixtureTicketRef(TARGET),
                [stage]: expect.objectContaining({ status: 'launch-failed', admission }),
              }),
            )
            expect(current.classifications).toEqual([])
            expect(current.dispatches).toEqual([])
            current.source.push(current.read([current.project], 3_000), {
              status: 'available',
              observedAt: 3_000,
            })
            expect(await current.override(stage)).toMatchObject({ ok: false })
            await setImmediate()
            expect(current.events().filter((event) => event.type === startType)).toHaveLength(1)
            expect(current.classifications).toEqual([])
            expect(current.dispatches).toEqual([])
          } finally {
            await current.stop()
          }
        },
      )
    }
  }

  it.each(['map file failure', 'omitted first map read'] satisfies SourceChange[])(
    'does not promote the second map after %s',
    async (change) => {
      const current = await harness({ secondaryTask: true })
      try {
        expect(readApplicationState(current.application.current()).projects[0]).toMatchObject({
          displayOrder: {
            open: [TARGET.mapId, SECONDARY.mapId].map((mapId) =>
              fixtureResourceRef({ project: TARGET.project, mapId }),
            ),
          },
          activeMap: {
            kind: 'known-current',
            ref: fixtureResourceRef({ project: TARGET.project, mapId: TARGET.mapId }),
          },
        })
        current.source.push(current.changedBatch(change, 2_000), {
          status: 'degraded',
          cause: 'The first map was not read.',
          observedAt: 2_000,
        })
        expect(readApplicationState(current.application.current()).projects[0]).toMatchObject({
          displayOrder: {
            open: [TARGET.mapId, SECONDARY.mapId].map((mapId) =>
              fixtureResourceRef({ project: TARGET.project, mapId }),
            ),
          },
          activeMap: { kind: 'uncertain' },
        })
        expect(await current.override('classification', SECONDARY)).toMatchObject({ ok: false })
        await current.enable()
        await setImmediate()
        expect(current.classifications).toEqual([])
        expect(current.dispatches).toEqual([])
        expect(current.events()).toEqual([])
      } finally {
        await current.stop()
      }
    },
  )

  it('does not reorder or admit new map content while map membership is incomplete', async () => {
    const current = await harness({ secondaryTask: true })
    try {
      const third = map('.wayfinder/newest.md', [ticket('newest')], 100)
      const newlyRead = current.read(
        [{ ...current.project, openMaps: [third, ...current.project.openMaps] }],
        2_000,
      )
      const partial: ObservationBatch = {
        attempts: newlyRead.attempts.map(
          (attempt): ObservationAttempt =>
            attempt.kind === 'observed' && attempt.scope.kind === 'maps-membership'
              ? { ...attempt, completeness: { kind: 'incomplete', reason: 'pagination' } }
              : attempt,
        ),
      }
      current.source.push(partial, { status: 'available', observedAt: 2_000 })
      expect(readApplicationState(current.application.current()).projects[0]).toMatchObject({
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: [TARGET.mapId, SECONDARY.mapId].map((mapId) =>
            fixtureResourceRef({ project: TARGET.project, mapId }),
          ),
        },
        maps: expect.arrayContaining([
          expect.objectContaining({
            ref: fixtureResourceRef({ project: PROJECT, mapId: '.wayfinder/newest.md' }),
            resource: expect.objectContaining({
              kind: 'current-readable',
              observation: expect.objectContaining({
                observedAt: 2_000,
                value: expect.objectContaining({ title: 'Map newest.md' }),
              }),
            }),
          }),
        ]),
      })
      expect(
        await current.override('classification', {
          project: PROJECT,
          mapId: '.wayfinder/newest.md',
          ticketId: 'newest',
        }),
      ).toMatchObject({ ok: false })
      await current.enable()
      await setImmediate()
      expect(current.classifications).toEqual([])
      expect(current.events()).toEqual([])
    } finally {
      await current.stop()
    }
  })

  it('admits the second map only after complete membership proves the first map absent', async () => {
    const current = await harness({ secondaryTask: true })
    try {
      current.source.push(current.changedBatch('map absence', 2_000), {
        status: 'available',
        observedAt: 2_000,
      })
      expect(readApplicationState(current.application.current()).projects[0]).toMatchObject({
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: TARGET.project, mapId: SECONDARY.mapId }),
        },
      })
      expect(
        selectedResource(
          readApplicationState(current.application.current()).projects[0],
          'map absence',
        ),
      ).toMatchObject({
        kind: 'proven-absent',
        trace: { kind: 'last-successful-trace' },
      })
      expect(await current.override('classification', TARGET)).toMatchObject({ ok: false })
      await current.enable()
      await vi.waitFor(() => expect(current.classifications).toHaveLength(1))
      expect(current.classifications[0]?.environment).toMatchObject({
        ROADMAP_MAP_ID: SECONDARY.mapId,
        ROADMAP_TICKET_ID: SECONDARY.ticketId,
      })
      expect(
        readApplicationState(current.application.current()).automation.evidence[0]?.target,
      ).toEqual(fixtureTicketRef(SECONDARY))
    } finally {
      await current.stop()
    }
  })

  it.each(['map absence', 'ticket absence'] satisfies SourceChange[])(
    'keeps repeated %s absent through an incomplete listing and failure until same-identity recovery',
    async (change) => {
      const current = await harness({ stage: 'wayfinder' })
      try {
        for (const observedAt of [2_000, 3_000])
          current.source.push(current.changedBatch(change, observedAt), {
            status: 'available',
            observedAt,
          })
        const absent = current.changedBatch(change, 4_000)
        const staleChildren = current.baseline.attempts.filter((attempt) =>
          change === 'map absence'
            ? ((attempt.scope.kind === 'map' || attempt.scope.kind === 'tickets-membership') &&
                attempt.scope.map.mapId === TARGET.mapId) ||
              (attempt.scope.kind === 'ticket' && attempt.scope.ticket.map.mapId === TARGET.mapId)
            : attempt.scope.kind === 'ticket' && attempt.scope.ticket.ticketId === TARGET.ticketId,
        )
        const partial: ObservationBatch = {
          attempts: [
            ...absent.attempts.map(
              (attempt): ObservationAttempt =>
                attempt.kind === 'observed' &&
                attempt.scope.kind ===
                  (change === 'map absence' ? 'maps-membership' : 'tickets-membership')
                  ? { ...attempt, completeness: { kind: 'incomplete', reason: 'pagination' } }
                  : attempt,
            ),
            ...staleChildren,
          ],
        }
        current.source.push(partial, { status: 'available', observedAt: 4_000 })
        expect(
          selectedResource(readApplicationState(current.application.current()).projects[0], change),
        ).toMatchObject({
          kind: 'proven-absent',
          absence: {
            observedAt: 3_000,
            provenance: { integration: 'local', operation: 'enumerate' },
            proof: { kind: 'complete-membership' },
          },
          trace: { kind: 'last-successful-trace', lastSuccessful: { observedAt: 1_000 } },
        })
        expect(await current.override('wayfinder')).toMatchObject({ ok: false })
        current.source.push(current.changedBatch('map directory failure', 5_000), {
          status: 'degraded',
          cause: 'The map directory is unavailable.',
          observedAt: 5_000,
        })
        expect(
          selectedResource(readApplicationState(current.application.current()).projects[0], change),
        ).toMatchObject({
          kind: 'proven-absent',
        })
        await current.enable()
        await setImmediate()
        expect(current.dispatches).toEqual([])
        expect(
          readApplicationState(current.application.current()).automation.evidence,
        ).toContainEqual(
          expect.objectContaining({
            target: fixtureTicketRef(TARGET),
            wayfinder: { status: 'queued' },
          }),
        )
        const recovered = content()
        const first = recovered.openMaps[0]
        if (!first) throw new Error('The fixture must contain its first map.')
        first.title = 'Recovered actual map'
        const recoveredTicket = first.tickets[0]
        if (!recoveredTicket) throw new Error('The fixture must contain its first ticket.')
        recoveredTicket.body = 'Actual recovered ticket prose.'
        current.source.push(current.read([recovered], 6_000), {
          status: 'available',
          observedAt: 6_000,
        })
        await vi.waitFor(() => expect(current.dispatches).toHaveLength(1))
        expect(readApplicationState(current.application.current()).projects[0]).toMatchObject({
          maps: expect.arrayContaining([
            expect.objectContaining({
              ref: fixtureResourceRef({ project: PROJECT, mapId: TARGET.mapId }),
              resource: expect.objectContaining({
                kind: 'current-readable',
                observation: expect.objectContaining({
                  observedAt: 6_000,
                  value: expect.objectContaining({ title: 'Recovered actual map' }),
                }),
              }),
              tickets: expect.arrayContaining([
                expect.objectContaining({
                  ref: fixtureResourceRef({
                    map: { project: PROJECT, mapId: TARGET.mapId },
                    ticketId: TARGET.ticketId,
                  }),
                  resource: expect.objectContaining({
                    kind: 'current-readable',
                    observation: expect.objectContaining({
                      observedAt: 6_000,
                      value: expect.objectContaining({ body: 'Actual recovered ticket prose.' }),
                    }),
                  }),
                }),
              ]),
            }),
          ]),
        })
        expect(current.dispatches[0]?.environment).toMatchObject({
          ROADMAP_MAP_ID: TARGET.mapId,
          ROADMAP_TICKET_ID: TARGET.ticketId,
        })
      } finally {
        await current.stop()
      }
    },
  )
})
