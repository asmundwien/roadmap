import { mkdir, mkdtemp, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { commandSchema } from '@roadmap/contracts/operations'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { decodeStateEnvelope } from '@roadmap/contracts/wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AutomationDatabase, appendAutomationDatabase } from '../automation/database.ts'
import type { ConfigurationDocument, ConfigurationRead } from '../configuration/document.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { createLocalObserver } from '../local/observer.ts'
import type {
  ObservationAttempt,
  ObservationBatch,
  SourceProjectKey as ProjectKey,
  SourceScope,
} from '../observation/source.ts'
import type { ProjectConfiguration } from '../projects/registry.ts'
import {
  fixtureProjectRef,
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
import { createApplicationOperations } from './operations.ts'

const filesystemFailures = vi.hoisted(() => new Map<string, Error>())

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      const failure = filesystemFailures.get(`enumerate:${String(args[0])}`)
      return failure ? Promise.reject(failure) : actual.readdir(...args)
    },
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      const failure = filesystemFailures.get(`read:${String(args[0])}`)
      return failure ? Promise.reject(failure) : actual.readFile(...args)
    },
  }
})

const PROJECT: ProjectKey = { integration: 'local', id: 'opaque:project/one' }
const ROOT = '/retention-controlled/source'
const FIRST = '.wayfinder/first/map.md'
const SECOND = '.wayfinder/second/map.md'
const THIRD = '.wayfinder/new/map.md'
const SECRET = 'private arbitrary filesystem exception detail'

function ticket(
  id = 'same:ticket/id',
  body = 'Original ticket prose.',
  mapId = FIRST,
  root = ROOT,
): FixtureTicket {
  return {
    id,
    title: 'Retained ticket',
    sourcePath: join(root, dirname(mapId), 'tickets', '01-ticket.md'),
    body,
    typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
    state: 'frontier',
    isClaimed: false,
    isBlocked: false,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
  }
}

function map(
  id: string,
  updatedAt: number,
  body = `Original ${id} prose.`,
  project = PROJECT,
  root = ROOT,
): FixtureMap {
  return {
    project,
    id,
    title: id,
    sourcePath: join(root, id),
    isOpen: true,
    updatedAt,
    body: {
      raw: body,
      destination: body,
      notes: [],
      decisions: [],
      notYetSpecified: [],
      notYetSpecifiedNote: '',
      outOfScope: [],
      sections: [],
      missingSections: [],
    },
    tickets: [ticket('same:ticket/id', 'Original ticket prose.', id, root)],
    progress: { total: 1, completed: 0 },
    ticketsComplete: true,
    warnings: [],
  }
}

function content(maps: FixtureMap[], key = PROJECT, root = ROOT): FixtureProject {
  return {
    key,
    name: 'Source Project',
    sourcePath: root,
    openMaps: maps,
    closedMaps: [],
    warnings: [],
  }
}

function configuration(projects: ProjectKey[] = [PROJECT], path = ROOT): ProjectConfiguration {
  return {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: projects.map((key, index) => ({
      ref: { integration: 'local', projectId: key.id },
      connectionId: 'local',
      workspace: { path: index === 0 ? path : join(path, 'other') },
    })),
    automation: { enabled: false, enabledProjects: [] },
  }
}

function document(value: ProjectConfiguration): ConfigurationDocument {
  return {
    async load() {
      return { ok: true, document: value }
    },
    subscribe() {
      return () => {}
    },
    async write() {
      throw new Error('Resource observations must not write configuration')
    },
    async stop() {},
  }
}

function controlled(initial: ObservationBatch, projects = [PROJECT]) {
  let clock = 1000
  const sources = projects.map((key) =>
    controlledSourceFixture(key, {
      attempts: initial.attempts.filter((attempt) => {
        const scope = attempt.scope
        const owner =
          scope.kind === 'project' || scope.kind === 'maps-membership'
            ? scope.project
            : scope.kind === 'ticket'
              ? scope.ticket.map.project
              : scope.map.project
        return owner.integration === key.integration && owner.id === key.id
      }),
    }),
  )
  const application = createRoadmapApplication({
    configuration: document(configuration(projects)),
    admissions: fixtureAdmissions,
    now: () => clock,
    operations: createApplicationOperations(),
    observers: {
      local(input) {
        const source = sources.find((_, index) => projects[index]?.id === input.ref.projectId)
        if (!source) throw new Error('Unexpected scoped Project')
        return source.observer
      },
      github() {
        throw new Error('No GitHub source belongs to this fixture')
      },
    },
  })
  return {
    application,
    push(batch: ObservationBatch, time: number, index = 0) {
      clock = time
      const source = sources[index]
      if (!source) throw new Error('Missing controlled source')
      const success = batch.attempts.find((attempt) => attempt.kind === 'observed')
      source.push(
        batch,
        success?.kind === 'observed'
          ? { status: 'available', observedAt: success.observedAt }
          : { status: 'unavailable', cause: 'Source cannot be read.' },
      )
    },
  }
}

function controlledReads() {
  const read = createSourceFixtureOwner()
  return {
    read,
    failed(
      scope: SourceScope,
      attemptedAt: number,
      path: string,
      operation: 'inspect-root' | 'enumerate' | 'read',
    ): ObservationAttempt {
      return {
        kind: 'failed',
        readSequence: read.nextReadSequence(),
        scope,
        attemptedAt,
        provenance: { integration: 'local', path, operation },
        failure: { kind: 'filesystem', operation, code: 'EACCES' },
      }
    },
    membership(
      batch: ObservationBatch,
      mapIds: string[],
      complete: boolean,
      time: number,
    ): ObservationBatch {
      return {
        attempts: batch.attempts.map((attempt): ObservationAttempt => {
          if (attempt.kind !== 'observed' || attempt.scope.kind !== 'maps-membership')
            return attempt
          const scope = attempt.scope
          return {
            kind: 'observed',
            readSequence: read.nextReadSequence(),
            scope,
            attemptedAt: time,
            observedAt: time,
            provenance: attempt.provenance,
            completeness: complete
              ? { kind: 'complete' }
              : { kind: 'incomplete', reason: 'pagination' },
            value: { members: mapIds.map((mapId) => ({ project: scope.project, mapId })) },
          }
        }),
      }
    },
  }
}

function expectProject(
  state: ReadyApplicationState,
  expected: Record<string, unknown>,
  key = PROJECT,
) {
  expect(
    state.projects.find(
      (project) => project.ref.integration === key.integration && project.ref.projectId === key.id,
    ),
  ).toMatchObject(expected)
}

function expectReadableBaseline(
  state: ReadyApplicationState,
  mapIds: string[],
  key = PROJECT,
  root = ROOT,
) {
  expectProject(
    state,
    {
      source: { integration: 'local', path: root },
      resource: { kind: 'current-readable', observation: { observedAt: 1000 } },
      mapsMembership: { kind: 'current-complete' },
      maps: expect.arrayContaining(
        mapIds.map((mapId) =>
          expect.objectContaining({
            ref: fixtureResourceRef({ project: key, mapId }),
            resource: expect.objectContaining({ kind: 'current-readable' }),
            ticketsMembership: expect.objectContaining({ kind: 'current-complete' }),
            tickets: expect.arrayContaining([
              expect.objectContaining({
                ref: fixtureResourceRef({
                  map: { project: key, mapId },
                  ticketId: 'same:ticket/id',
                }),
                resource: expect.objectContaining({ kind: 'current-readable' }),
              }),
            ]),
          }),
        ),
      ),
    },
    key,
  )
}

function expectedMap(mapId: string, resource: unknown, extra = {}) {
  return partial({ ref: fixtureResourceRef({ project: PROJECT, mapId }), resource, ...extra })
}

function partial(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  if ('asymmetricMatch' in value) return value
  if (Array.isArray(value)) return value.map((item: unknown) => partial(item))
  return expect.objectContaining(
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, partial(item)])),
  )
}

afterEach(() => {
  filesystemFailures.clear()
})

describe('RoadmapApplication retained resource truth', () => {
  it('keeps one sufficient scoped Project authority through source loss and same-ID recovery', async () => {
    const { read, failed } = controlledReads()
    const test = controlled(read([content([map(FIRST, 900)])], 1000))
    try {
      await test.application.start()
      expect(readApplicationState(test.application.current())).toMatchObject({
        phase: 'ready',
        projects: [
          {
            integration: 'local',
            ref: { integration: 'local', projectId: PROJECT.id },
            source: { integration: 'local', path: ROOT },
            management: {},
            maps: [
              {
                ref: { project: { integration: 'local', projectId: PROJECT.id }, mapId: FIRST },
                frontier: [
                  {
                    map: { project: { integration: 'local', projectId: PROJECT.id }, mapId: FIRST },
                    ticketId: 'same:ticket/id',
                  },
                ],
              },
            ],
          },
        ],
      })
      test.push(
        { attempts: [failed({ kind: 'project', project: PROJECT }, 2000, ROOT, 'inspect-root')] },
        2000,
      )
      expect(readApplicationState(test.application.current())).toMatchObject({
        projects: [
          {
            source: { path: ROOT },
            resource: { kind: 'retained-unavailable', lastSuccessful: { observedAt: 1000 } },
          },
        ],
      })
      const recovered = content([map(FIRST, 900, 'Recovered graph and prose.')])
      test.push(read([recovered], 3000), 3000)
      expect(readApplicationState(test.application.current())).toMatchObject({
        projects: [
          {
            ref: { integration: 'local', projectId: PROJECT.id },
            source: { path: ROOT },
            resource: { kind: 'current-readable', observation: { observedAt: 3000 } },
            maps: [
              {
                resource: {
                  observation: { value: { body: { raw: 'Recovered graph and prose.' } } },
                },
              },
            ],
          },
        ],
      })
    } finally {
      await test.application.stop()
    }
  })

  // Catches invented payloads for registered Projects or listed maps that have never been read.
  it('distinguishes a never-read Project and map from a complete known-empty Project', async () => {
    const { read, failed, membership } = controlledReads()
    const never = controlled({
      attempts: [failed({ kind: 'project', project: PROJECT }, 1000, ROOT, 'inspect-root')],
    })
    try {
      await never.application.start()
      expectProject(readApplicationState(never.application.current()), {
        resource: {
          kind: 'never-observed',
          current: {
            scope: { kind: 'project', project: fixtureResourceRef(PROJECT) },
            attemptedAt: 1000,
          },
        },
        maps: [],
        activeMap: { kind: 'uncertain' },
      })
      const empty = read([content([])], 2000)
      never.push(empty, 2000)
      expectProject(readApplicationState(never.application.current()), {
        resource: {
          kind: 'current-readable',
          observation: { observedAt: 2000, value: { name: 'Source Project' } },
        },
        mapsMembership: { kind: 'current-complete', observation: { value: { members: [] } } },
        maps: [],
        activeMap: { kind: 'known-empty' },
      })
      const listed = membership(empty, [FIRST], true, 3000)
      never.push(
        {
          attempts: [
            ...listed.attempts,
            failed(
              { kind: 'map', map: { project: PROJECT, mapId: FIRST } },
              3000,
              join(ROOT, FIRST),
              'read',
            ),
          ],
        },
        3000,
      )
      expectProject(readApplicationState(never.application.current()), {
        maps: [
          expectedMap(FIRST, {
            kind: 'never-observed',
            current: { attemptedAt: 3000, failure: { kind: 'filesystem', code: 'EACCES' } },
          }),
        ],
        activeMap: { kind: 'uncertain' },
      })
      never.push(read([content([])], 4000), 4000)
      expectProject(readApplicationState(never.application.current()), {
        activeMap: { kind: 'known-empty' },
        displayOrder: { open: [].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })) },
        maps: [
          expectedMap(FIRST, {
            kind: 'proven-absent',
            absence: { observedAt: 4000, proof: { kind: 'complete-membership' } },
            trace: { kind: 'no-known-trace' },
          }),
        ],
      })
    } finally {
      await never.application.stop()
    }
  })

  // Catches filtering an unreadable active map or allowing new content to reorder an uncertain list.
  it('preserves the two-map order while a failed head and newly read content remain addressable', async () => {
    const { read, failed } = controlledReads()
    const baseline = read([content([map(FIRST, 900), map(SECOND, 800)])], 1000)
    const test = controlled(baseline)
    try {
      await test.application.start()
      expectReadableBaseline(readApplicationState(test.application.current()), [FIRST, SECOND])
      expectProject(readApplicationState(test.application.current()), {
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
        },
        displayOrder: {
          open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
      })
      const later = read(
        [
          content([
            map(SECOND, 9000, 'Updated sibling prose.'),
            map(THIRD, 10000, 'New unordered map prose.'),
          ]),
        ],
        2000,
      )
      const partial: ObservationBatch = {
        attempts: later.attempts.map((attempt) =>
          attempt.kind === 'observed' && attempt.scope.kind === 'maps-membership'
            ? { ...attempt, completeness: { kind: 'incomplete', reason: 'pagination' } }
            : attempt,
        ),
      }
      test.push(
        {
          attempts: [
            ...partial.attempts,
            failed(
              { kind: 'map', map: { project: PROJECT, mapId: FIRST } },
              2000,
              join(ROOT, FIRST),
              'read',
            ),
          ],
        },
        2000,
      )
      expectProject(readApplicationState(test.application.current()), {
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
        maps: expect.arrayContaining([
          expectedMap(FIRST, {
            kind: 'retained-unavailable',
            lastSuccessful: {
              observedAt: 1000,
              value: {
                body: { raw: `Original ${FIRST} prose.` },
                source: { kind: 'file', path: join(ROOT, FIRST) },
              },
            },
            unavailable: { attemptedAt: 2000, failure: { kind: 'filesystem', operation: 'read' } },
          }),
          expectedMap(SECOND, {
            kind: 'current-readable',
            observation: { observedAt: 2000, value: { body: { raw: 'Updated sibling prose.' } } },
          }),
          expectedMap(THIRD, {
            kind: 'current-readable',
            observation: { observedAt: 2000, value: { body: { raw: 'New unordered map prose.' } } },
          }),
        ]),
      })
    } finally {
      await test.application.stop()
    }
  })

  // Catches stale repeated child attempts resurrecting complete-parent absence on later partial/failure commits.
  it('keeps complete map absence sticky through repeated complete, failed and incomplete listings', async () => {
    const { read, failed, membership } = controlledReads()
    const baseline = read([content([map(FIRST, 900), map(SECOND, 800)])], 1000)
    const test = controlled(baseline)
    try {
      await test.application.start()
      expectReadableBaseline(readApplicationState(test.application.current()), [FIRST, SECOND])
      let absentBatch = baseline
      for (const time of [2000, 3000]) {
        const currentSecond = read([content([map(SECOND, 800)])], time)
        const oldFirst = baseline.attempts.filter(
          (attempt) =>
            attempt.scope.kind !== 'project' &&
            attempt.scope.kind !== 'maps-membership' &&
            (attempt.scope.kind === 'ticket'
              ? attempt.scope.ticket.map.mapId
              : attempt.scope.map.mapId) === FIRST,
        )
        absentBatch = { attempts: [...currentSecond.attempts, ...oldFirst] }
        test.push(absentBatch, time)
        expectProject(readApplicationState(test.application.current()), {
          activeMap: {
            kind: 'known-current',
            ref: fixtureResourceRef({ project: PROJECT, mapId: SECOND }),
          },
          displayOrder: {
            open: [SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
          },
          maps: expect.arrayContaining([
            expectedMap(FIRST, {
              kind: 'proven-absent',
              absence: {
                observedAt: time,
                proof: {
                  kind: 'complete-membership',
                  parent: { kind: 'maps-membership', project: fixtureResourceRef(PROJECT) },
                },
              },
              trace: {
                kind: 'last-successful-trace',
                lastSuccessful: {
                  observedAt: 1000,
                  value: { body: { raw: `Original ${FIRST} prose.` } },
                },
              },
            }),
          ]),
        })
      }
      test.push(
        {
          attempts: absentBatch.attempts.map((attempt) =>
            attempt.scope.kind === 'maps-membership'
              ? failed(attempt.scope, 4000, join(ROOT, '.wayfinder'), 'enumerate')
              : attempt,
          ),
        },
        4000,
      )
      expectProject(readApplicationState(test.application.current()), {
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: [SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
        maps: expect.arrayContaining([
          expectedMap(FIRST, {
            kind: 'proven-absent',
            absence: { observedAt: 3000 },
            trace: { kind: 'last-successful-trace', lastSuccessful: { observedAt: 1000 } },
          }),
        ]),
      })
      test.push(membership(absentBatch, [SECOND], false, 5000), 5000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: { kind: 'uncertain' },
        maps: expect.arrayContaining([
          expectedMap(FIRST, {
            kind: 'proven-absent',
            absence: { observedAt: 3000 },
            trace: { kind: 'last-successful-trace', lastSuccessful: { observedAt: 1000 } },
          }),
        ]),
      })
    } finally {
      await test.application.stop()
    }
  })

  // Catches payload/provenance replacement being skipped on same-identity recovery.
  it('recovers the same absent identity with new actual payload and source provenance', async () => {
    const { read } = controlledReads()
    const test = controlled(read([content([map(FIRST, 900), map(SECOND, 800)])], 1000))
    try {
      await test.application.start()
      expectReadableBaseline(readApplicationState(test.application.current()), [FIRST, SECOND])
      test.push(read([content([map(SECOND, 800)])], 2000), 2000)
      const recovered = map(FIRST, 4000, 'Recovered map prose.')
      const recoveredTicketPath = join(ROOT, dirname(FIRST), 'tickets', '02-recovered-ticket.md')
      const recoveredTicket = ticket('same:ticket/id', 'Recovered ticket prose.')
      recoveredTicket.sourcePath = recoveredTicketPath
      recovered.tickets = [recoveredTicket]
      test.push(read([content([recovered, map(SECOND, 800)])], 4000), 4000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
        },
        displayOrder: {
          open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            {
              kind: 'current-readable',
              observation: {
                observedAt: 4000,
                provenance: {
                  integration: 'local',
                  path: join(ROOT, FIRST),
                  operation: 'read',
                },
                value: {
                  body: { raw: 'Recovered map prose.' },
                  source: { kind: 'file', path: join(ROOT, FIRST) },
                },
              },
            },
            {
              tickets: [
                {
                  ref: fixtureResourceRef({
                    map: { project: PROJECT, mapId: FIRST },
                    ticketId: 'same:ticket/id',
                  }),
                  resource: {
                    kind: 'current-readable',
                    observation: {
                      observedAt: 4000,
                      provenance: { path: recoveredTicketPath },
                      value: { body: 'Recovered ticket prose.' },
                    },
                  },
                },
              ],
            },
          ),
        ]),
      })
    } finally {
      await test.application.stop()
    }
  })

  // Catches complete ticket absence being erased by an older repeated child success or failed list.
  it('retains a proven-absent ticket independently of a readable parent map', async () => {
    const { read, failed } = controlledReads()
    const baseline = read([content([map(FIRST, 900)])], 1000)
    const test = controlled(baseline)
    try {
      await test.application.start()
      expectReadableBaseline(readApplicationState(test.application.current()), [FIRST])
      const emptyMap = map(FIRST, 900)
      emptyMap.tickets = []
      emptyMap.progress = { total: 0, completed: 0 }
      const complete = read([content([emptyMap])], 2000)
      const oldTicket = baseline.attempts.filter((attempt) => attempt.scope.kind === 'ticket')
      test.push({ attempts: [...complete.attempts, ...oldTicket] }, 2000)
      for (const time of [3000, 4000]) {
        test.push(
          {
            attempts: [
              ...complete.attempts.map((attempt) =>
                attempt.scope.kind === 'tickets-membership'
                  ? failed(attempt.scope, time, join(ROOT, '.wayfinder/first/tickets'), 'enumerate')
                  : attempt,
              ),
              ...oldTicket,
            ],
          },
          time,
        )
        expectProject(readApplicationState(test.application.current()), {
          maps: expect.arrayContaining([
            expectedMap(FIRST, expect.anything(), {
              tickets: [
                {
                  ref: fixtureResourceRef({
                    map: { project: PROJECT, mapId: FIRST },
                    ticketId: 'same:ticket/id',
                  }),
                  resource: {
                    kind: 'proven-absent',
                    absence: { observedAt: 2000, proof: { kind: 'complete-membership' } },
                    trace: {
                      kind: 'last-successful-trace',
                      lastSuccessful: {
                        observedAt: 1000,
                        value: { body: 'Original ticket prose.' },
                      },
                    },
                  },
                },
              ],
            }),
          ]),
        })
      }
    } finally {
      await test.application.stop()
    }
  })

  // Catches explicit new membership being ignored when the returning ticket's own read fails.
  it.each([
    { hadSuccess: true, complete: true },
    { hadSuccess: true, complete: false },
    { hadSuccess: false, complete: true },
    { hadSuccess: false, complete: false },
  ])(
    'reports returning ticket read failure with prior success $hadSuccess and complete membership $complete',
    async ({ hadSuccess, complete }) => {
      const { read, failed } = controlledReads()
      const baseline = read([content([map(FIRST, 900), map(SECOND, 800)])], 1000)
      const ticketKey = { map: { project: PROJECT, mapId: FIRST }, ticketId: 'same:ticket/id' }
      const path = join(ROOT, '.wayfinder/first/tickets/01-ticket.md')
      const test = controlled({
        attempts: baseline.attempts.map((attempt) =>
          !hadSuccess && attempt.scope.kind === 'ticket' && attempt.scope.ticket.map.mapId === FIRST
            ? failed(attempt.scope, 1000, path, 'read')
            : attempt,
        ),
      })
      try {
        await test.application.start()
        const emptyMap = map(FIRST, 900)
        emptyMap.tickets = []
        emptyMap.progress = { total: 0, completed: 0 }
        const absence = read([content([emptyMap, map(SECOND, 800)])], 2000)
        test.push(absence, 2000)
        const absent = {
          kind: 'proven-absent',
          absence: { observedAt: 2000, proof: { kind: 'complete-membership' } },
          trace: hadSuccess
            ? { kind: 'last-successful-trace', lastSuccessful: { observedAt: 1000 } }
            : { kind: 'no-known-trace' },
        }
        expectProject(readApplicationState(test.application.current()), {
          maps: expect.arrayContaining([
            expectedMap(FIRST, expect.anything(), {
              tickets: [{ ref: fixtureResourceRef(ticketKey), resource: absent }],
            }),
          ]),
        })
        // A later publication of the old positive list does not negate the newer omission proof.
        test.push(
          { attempts: baseline.attempts.filter((attempt) => attempt.scope.kind !== 'ticket') },
          2500,
        )
        expectProject(readApplicationState(test.application.current()), {
          maps: expect.arrayContaining([
            expectedMap(FIRST, expect.anything(), {
              tickets: [{ ref: fixtureResourceRef(ticketKey), resource: absent }],
            }),
          ]),
        })
        const returningMap = map(FIRST, 900)
        returningMap.ticketsComplete = complete
        const current = read([content([returningMap, map(SECOND, 800)])], 3000)
        test.push(
          {
            attempts: current.attempts.map((attempt) =>
              attempt.scope.kind === 'ticket' && attempt.scope.ticket.map.mapId === FIRST
                ? failed(attempt.scope, 3000, path, 'read')
                : attempt,
            ),
          },
          9000,
        )
        const unavailable = {
          kind: 'source-failure',
          scope: { kind: 'ticket', ticket: fixtureResourceRef(ticketKey) },
          attemptedAt: 3000,
          provenance: { integration: 'local', path, operation: 'read' },
          failure: { kind: 'filesystem', operation: 'read', code: 'EACCES' },
          cause: 'Source read permission was denied.',
        }
        expectProject(readApplicationState(test.application.current()), {
          activeMap: { kind: 'uncertain' },
          displayOrder: {
            open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
          },
          maps: expect.arrayContaining([
            expectedMap(
              FIRST,
              { kind: 'current-readable' },
              {
                ticketsMembership: {
                  kind: complete ? 'current-complete' : 'current-incomplete',
                  observation: {
                    observedAt: 3000,
                    value: { members: [fixtureResourceRef(ticketKey)] },
                  },
                },
                tickets: [
                  {
                    ref: fixtureResourceRef(ticketKey),
                    resource: hadSuccess
                      ? {
                          kind: 'retained-unavailable',
                          unavailable,
                          lastSuccessful: {
                            observedAt: 1000,
                            provenance: { integration: 'local', path, operation: 'read' },
                            value: {
                              body: 'Original ticket prose.',
                              source: { kind: 'file', path },
                            },
                          },
                        }
                      : { kind: 'never-observed', current: unavailable },
                  },
                ],
              },
            ),
          ]),
        })
        expect(
          await test.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target: fixtureTicketRef({
                project: PROJECT,
                mapId: FIRST,
                ticketId: ticketKey.ticketId,
              }),
              stage: 'classification',
            }),
          ),
        ).toMatchObject({ ok: false })
        expect(readApplicationState(test.application.current()).automation.evidence).toEqual([])
        test.push(read([content([map(FIRST, 900), map(SECOND, 800)])], 4000), 10000)
        expectProject(readApplicationState(test.application.current()), {
          activeMap: {
            kind: 'known-current',
            ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
          },
          maps: expect.arrayContaining([
            expectedMap(
              FIRST,
              { kind: 'current-readable' },
              {
                tickets: [
                  {
                    ref: fixtureResourceRef(ticketKey),
                    resource: {
                      kind: 'current-readable',
                      observation: { observedAt: 4000, value: { body: 'Original ticket prose.' } },
                    },
                  },
                ],
              },
            ),
          ]),
        })
      } finally {
        await test.application.stop()
      }
    },
  )

  // Catches partial explicit inclusion reviving old content or later replay reinstating stale absence.
  it.each([true, false])(
    'keeps returning map content unavailable under partial positive membership with prior success %s',
    async (hadSuccess) => {
      const { read, failed, membership } = controlledReads()
      const baseline = read([content([map(FIRST, 900), map(SECOND, 800)])], 1000)
      const mapScope = {
        kind: 'map',
        map: { project: PROJECT, mapId: FIRST },
      } satisfies SourceScope
      const path = join(ROOT, FIRST)
      const test = controlled({
        attempts: baseline.attempts.map((attempt) =>
          !hadSuccess && attempt.scope.kind === 'map' && attempt.scope.map.mapId === FIRST
            ? failed(attempt.scope, 1000, path, 'read')
            : attempt,
        ),
      })
      try {
        await test.application.start()
        const empty = read([content([map(SECOND, 800)])], 2000)
        test.push(empty, 2000)
        const list = empty.attempts.find((attempt) => attempt.scope.kind === 'maps-membership')
        if (!list || list.kind !== 'observed') throw new Error('Expected actual membership fixture')
        const oldAbsence = {
          kind: 'proven-absent',
          readSequence: list.readSequence,
          scope: mapScope,
          attemptedAt: 2000,
          observedAt: 2000,
          provenance: list.provenance,
          proof: {
            kind: 'complete-membership',
            parent: { kind: 'maps-membership', project: PROJECT },
          },
        } satisfies ObservationAttempt
        const positive = membership(empty, [FIRST, SECOND], false, 3000)
        test.push({ attempts: [...positive.attempts, failed(mapScope, 3000, path, 'read')] }, 3000)
        expectProject(readApplicationState(test.application.current()), {
          activeMap: { kind: 'uncertain' },
          displayOrder: {
            open: [SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
          },
          mapsMembership: {
            kind: 'current-incomplete',
            observation: {
              observedAt: 3000,
              value: {
                members: [mapScope.map, { project: PROJECT, mapId: SECOND }].map(
                  fixtureResourceRef,
                ),
              },
            },
          },
          maps: expect.arrayContaining([
            expectedMap(
              FIRST,
              hadSuccess
                ? {
                    kind: 'retained-unavailable',
                    lastSuccessful: {
                      observedAt: 1000,
                      value: { body: { raw: `Original ${FIRST} prose.` } },
                    },
                    unavailable: {
                      attemptedAt: 3000,
                      failure: { kind: 'filesystem', operation: 'read', code: 'EACCES' },
                    },
                  }
                : {
                    kind: 'never-observed',
                    current: { attemptedAt: 3000, failure: { kind: 'filesystem', code: 'EACCES' } },
                  },
            ),
          ]),
        })
        test.push(
          {
            attempts: [
              ...positive.attempts,
              ...baseline.attempts.filter(
                (attempt) =>
                  hadSuccess && attempt.scope.kind === 'map' && attempt.scope.map.mapId === FIRST,
              ),
            ],
          },
          9000,
        )
        expectProject(readApplicationState(test.application.current()), {
          maps: expect.arrayContaining([
            expectedMap(FIRST, {
              kind: hadSuccess ? 'retained-unavailable' : 'never-observed',
            }),
          ]),
        })
        test.push(
          {
            attempts: [
              ...positive.attempts.filter((attempt) => attempt.scope.kind !== 'maps-membership'),
              failed(
                { kind: 'maps-membership', project: PROJECT },
                4000,
                join(ROOT, '.wayfinder'),
                'enumerate',
              ),
              oldAbsence,
            ],
          },
          10000,
        )
        expectProject(readApplicationState(test.application.current()), {
          maps: expect.arrayContaining([
            expectedMap(FIRST, {
              kind: hadSuccess ? 'retained-unavailable' : 'never-observed',
            }),
          ]),
        })
      } finally {
        await test.application.stop()
      }
    },
  )

  // Catches readable malformed content being treated as unavailable/empty or unknown blockers as eligibility.
  it('keeps incomplete readable Markdown raw and warned with unknown counts and blockers', async () => {
    const { read } = controlledReads()
    const incompleteMap = map(FIRST, 900, '## Unrecognized\n\nReadable incomplete Markdown.\n')
    incompleteMap.progress = null
    incompleteMap.ticketsComplete = false
    incompleteMap.warnings = ['Incomplete readable map.']
    const unknownTicket = ticket()
    unknownTicket.blockersComplete = false
    unknownTicket.isBlocked = true
    unknownTicket.state = 'blocked'
    unknownTicket.blockedBy = [
      {
        reference: { kind: 'unresolved', locator: 'unknown/source' },
        ticketId: 'missing',
        state: 'unknown',
      },
    ]
    incompleteMap.tickets = [unknownTicket]
    const test = controlled(read([content([map(FIRST, 900)])], 1000))
    const batch = read([content([incompleteMap])], 2000)
    const incomplete = {
      attempts: batch.attempts.map((attempt) =>
        attempt.kind === 'observed' &&
        (attempt.scope.kind === 'map' || attempt.scope.kind === 'ticket')
          ? { ...attempt, completeness: { kind: 'incomplete', reason: 'malformed' } }
          : attempt,
      ),
    } satisfies ObservationBatch
    try {
      await test.application.start()
      expectReadableBaseline(readApplicationState(test.application.current()), [FIRST])
      test.push(incomplete, 2000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: { kind: 'uncertain' },
        maps: [
          expectedMap(
            FIRST,
            {
              kind: 'current-readable',
              observation: {
                observedAt: 2000,
                completeness: { kind: 'incomplete' },
                value: {
                  body: { raw: '## Unrecognized\n\nReadable incomplete Markdown.\n' },
                  progress: null,
                  warnings: ['Incomplete readable map.'],
                },
              },
            },
            {
              tickets: [
                {
                  resource: {
                    kind: 'current-readable',
                    observation: {
                      value: {
                        body: 'Original ticket prose.',
                        blockersComplete: false,
                        blockedBy: [{ state: 'unknown' }],
                      },
                    },
                  },
                },
              ],
            },
          ),
        ],
      })
    } finally {
      await test.application.stop()
    }
  })

  // Catches string-delimited indexes merging map/ticket identities from different opaque parents.
  it('keeps identical map and ticket IDs scoped to opaque Project identities', async () => {
    const { read, failed } = controlledReads()
    const otherRead = createSourceFixtureOwner()
    const other: ProjectKey = { integration: 'local', id: 'opaque:project/one:second' }
    const firstMap = map('same:map/id', 900, 'First Project prose.')
    const otherRoot = join(ROOT, 'other')
    const otherMap = map('same:map/id', 800, 'Other Project prose.', other, otherRoot)
    const otherContent = content([otherMap], other, otherRoot)
    const test = controlled(
      {
        attempts: [
          ...read([content([firstMap])], 1000).attempts,
          ...otherRead([otherContent], 1000).attempts,
        ],
      },
      [PROJECT, other],
    )
    try {
      await test.application.start()
      expectReadableBaseline(readApplicationState(test.application.current()), ['same:map/id'])
      expectReadableBaseline(
        readApplicationState(test.application.current()),
        ['same:map/id'],
        other,
        otherRoot,
      )
      test.push(
        { attempts: [failed({ kind: 'project', project: PROJECT }, 2000, ROOT, 'inspect-root')] },
        2000,
      )
      expectProject(readApplicationState(test.application.current()), {
        resource: { kind: 'retained-unavailable' },
        maps: [
          {
            resource: {
              kind: 'retained-unavailable',
              lastSuccessful: { value: { body: { raw: 'First Project prose.' } } },
            },
          },
        ],
      })
      expectProject(
        readApplicationState(test.application.current()),
        {
          resource: { kind: 'current-readable', observation: { observedAt: 1000 } },
          maps: [
            {
              ref: fixtureResourceRef({ project: other, mapId: 'same:map/id' }),
              resource: {
                kind: 'current-readable',
                observation: { value: { body: { raw: 'Other Project prose.' } } },
              },
              tickets: [
                {
                  ref: fixtureResourceRef({
                    map: { project: other, mapId: 'same:map/id' },
                    ticketId: 'same:ticket/id',
                  }),
                },
              ],
            },
          ],
        },
        other,
      )
    } finally {
      await test.application.stop()
    }
  })
})

async function localFixture(withAdmission = false) {
  const temporary = await mkdtemp(join(tmpdir(), 'roadmap-resource-retention-'))
  const root = await realpath(temporary)
  let clock = 1000
  for (const [directory, modified] of [
    ['first', 900],
    ['second', 800],
  ] as const) {
    const location = join(root, '.wayfinder', directory)
    await mkdir(join(location, 'tickets'), { recursive: true })
    await writeFile(
      join(location, 'map.md'),
      '---\ntitle: Local map\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\nActual Local map prose.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n',
    )
    await writeFile(
      join(location, 'tickets/01-ticket.md'),
      '---\nid: 1\ntitle: Local ticket\nlabels: [wayfinder:task]\nstatus: open\n---\n\nActual Local ticket prose.\n',
    )
    await utimes(join(location, 'map.md'), modified / 1000, modified / 1000)
    await utimes(join(location, 'tickets/01-ticket.md'), modified / 1000, modified / 1000)
  }
  let configured = configuration([PROJECT], root)
  if (withAdmission) {
    const command = {
      command: process.execPath,
      args: [],
      promptDelivery: 'stdin' as const,
      promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
    }
    configured.automation = {
      enabled: false,
      enabledProjects: [PROJECT],
      classificationCommand: command,
      wayfinderCommand: command,
    }
  }
  let stored: AutomationDatabase = { schemaVersion: 3, opportunities: [], events: [] }
  const listeners = new Set<(read: ConfigurationRead) => void>()
  const launches: string[] = []
  const configurationDocument: ConfigurationDocument = {
    ...document(configured),
    async load() {
      return { ok: true, document: configured }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const application = createRoadmapApplication({
    configuration: configurationDocument,
    admissions: { local: createLocalProjectAdmission() },
    now: () => clock,
    operations: createApplicationOperations(),
    observers: {
      local: (input) =>
        createLocalObserver(input, {
          now: () => clock,
          watchDirectory: () => ({ close() {} }),
          logger: { info() {}, warn() {} },
        }),
      github() {
        throw new Error('No GitHub source belongs to this fixture')
      },
    },
    ...(withAdmission
      ? {
          automation: {
            database: {
              async load() {
                return stored
              },
              async append(batch: Parameters<typeof appendAutomationDatabase>[1]) {
                stored = appendAutomationDatabase(stored, batch)
                return { database: stored, durability: 'confirmed' as const }
              },
            },
            launcher: {
              classify() {
                launches.push('classification')
                throw new Error('Unavailable parent must deny Classification launch')
              },
              async dispatch() {
                launches.push('wayfinder')
                throw new Error('Unavailable parent must deny Session launch')
              },
            },
          },
        }
      : {}),
  })
  return {
    root,
    application,
    launches,
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
    async refresh(time: number) {
      clock = time
      expect(
        (
          await application.execute(
            commandSchema.parse({
              type: 'refresh-project',
              project: fixtureProjectRef(PROJECT),
              expectedConfigurationVersion: configured.configurationVersion,
            }),
          )
        ).ok,
      ).toBe(true)
    },
    async stop() {
      filesystemFailures.clear()
      await application.stop()
      await rm(temporary, { recursive: true, force: true })
    },
  }
}

describe('RoadmapApplication actual Local observer retention', () => {
  it('keeps duplicate Local blocker IDs within each originating map through retained and absent targets', async () => {
    const test = await localFixture()
    try {
      for (const [mapId, status] of [
        [FIRST, 'closed'],
        [SECOND, 'open'],
      ] as const) {
        const directory = join(test.root, dirname(mapId), 'tickets')
        await writeFile(
          join(directory, '01-ticket.md'),
          `---\nid: 1\ntitle: Scoped blocker\nlabels: [wayfinder:task]\nstatus: ${status}\n---\n\nActual scoped blocker prose.\n`,
        )
        await writeFile(
          join(directory, '02-dependent.md'),
          '---\nid: 2\ntitle: Dependent\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: [1]\n---\n\nActual dependent prose.\n',
        )
      }
      await test.application.start()
      function expectScopedBlockers(firstState: string, firstComplete: boolean) {
        const state = readApplicationState(test.application.current())
        for (const [mapId, blockerState, complete] of [
          [FIRST, firstState, firstComplete],
          [SECOND, 'open', true],
        ] as const) {
          const dependent = state.projects[0]?.maps
            .find((map) => map.ref.mapId === mapId)
            ?.tickets.find((ticket) => ticket.ref.ticketId === '2')
          expect(dependent?.resource).toMatchObject({
            kind: 'current-readable',
            observation: {
              value: {
                blockedBy: [
                  {
                    reference: {
                      kind: 'registered',
                      ticket: fixtureResourceRef({
                        map: { project: PROJECT, mapId },
                        ticketId: '1',
                      }),
                    },
                    state: blockerState,
                  },
                ],
                blockersComplete: complete,
              },
            },
          })
        }
        expect(
          decodeStateEnvelope(JSON.parse(JSON.stringify({ type: 'state', state }))),
        ).toMatchObject({
          ok: true,
        })
      }
      expectScopedBlockers('closed', true)
      const target = join(test.root, dirname(FIRST), 'tickets/01-ticket.md')
      filesystemFailures.set(`read:${target}`, Object.assign(new Error(SECRET), { code: 'EACCES' }))
      await test.refresh(2000)
      expectScopedBlockers('unknown', false)
      expectProject(readApplicationState(test.application.current()), {
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            { kind: 'current-readable' },
            {
              tickets: expect.arrayContaining([
                partial({
                  ref: fixtureResourceRef({
                    map: { project: PROJECT, mapId: FIRST },
                    ticketId: '1',
                  }),
                  resource: { kind: 'retained-unavailable' },
                }),
              ]),
            },
          ),
        ]),
      })
      filesystemFailures.clear()
      await rm(target)
      await test.refresh(3000)
      expectScopedBlockers('unknown', false)
      expectProject(readApplicationState(test.application.current()), {
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            { kind: 'current-readable' },
            {
              tickets: expect.arrayContaining([
                partial({
                  ref: fixtureResourceRef({
                    map: { project: PROJECT, mapId: FIRST },
                    ticketId: '1',
                  }),
                  resource: { kind: 'proven-absent' },
                }),
              ]),
            },
          ),
        ]),
      })
    } finally {
      await test.stop()
    }
  })

  it('keeps a missing Local blocker scoped to its map instead of another maps matching ticket', async () => {
    const test = await localFixture()
    try {
      await writeFile(
        join(test.root, dirname(FIRST), 'tickets/01-ticket.md'),
        '---\nid: 2\ntitle: Dependent\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: [1]\n---\n\nActual dependent prose.\n',
      )
      await test.application.start()
      const state = readApplicationState(test.application.current())
      const first = state.projects[0]?.maps.find((map) => map.ref.mapId === FIRST)
      expect(first?.tickets).toHaveLength(1)
      expect(first?.tickets[0]?.resource).toMatchObject({
        kind: 'current-readable',
        observation: {
          completeness: { kind: 'incomplete' },
          value: {
            blockedBy: [
              {
                reference: {
                  kind: 'registered',
                  ticket: fixtureResourceRef({
                    map: { project: PROJECT, mapId: FIRST },
                    ticketId: '1',
                  }),
                },
                state: 'unknown',
              },
            ],
            blockersComplete: false,
          },
        },
      })
      expect(
        state.projects[0]?.maps.find((map) => map.ref.mapId === SECOND)?.tickets[0]?.ref,
      ).toEqual(fixtureResourceRef({ map: { project: PROJECT, mapId: SECOND }, ticketId: '1' }))
      expect(
        decodeStateEnvelope(JSON.parse(JSON.stringify({ type: 'state', state }))),
      ).toMatchObject({
        ok: true,
      })
    } finally {
      await test.stop()
    }
  })

  // Catches catalog locale collation disagreeing with the strict public decoder's ID order.
  it('publishes decodable code-unit ordering for actual Local maps with equal update times', async () => {
    const test = await localFixture()
    const upper = '.wayfinder/Z/map.md'
    const lower = '.wayfinder/a/map.md'
    try {
      await rename(join(test.root, '.wayfinder/first'), join(test.root, '.wayfinder/Z'))
      await rename(join(test.root, '.wayfinder/second'), join(test.root, '.wayfinder/a'))
      for (const mapId of [upper, lower]) await utimes(join(test.root, mapId), 0.9, 0.9)
      await test.application.start()
      const state = readApplicationState(test.application.current())
      expectProject(state, {
        resource: {
          kind: 'current-readable',
          observation: { observedAt: 1000, completeness: { kind: 'complete' } },
        },
        mapsMembership: { kind: 'current-complete' },
        maps: expect.arrayContaining(
          [upper, lower].map((mapId) =>
            partial({
              ref: fixtureResourceRef({ project: PROJECT, mapId }),
              resource: {
                kind: 'current-readable',
                observation: {
                  observedAt: 1000,
                  completeness: { kind: 'complete' },
                  provenance: {
                    integration: 'local',
                    path: join(test.root, mapId),
                    operation: 'read',
                  },
                  value: { updatedAt: 900 },
                },
              },
              ticketsMembership: { kind: 'current-complete' },
              tickets: [
                {
                  resource: {
                    kind: 'current-readable',
                    observation: { observedAt: 1000, completeness: { kind: 'complete' } },
                  },
                },
              ],
            }),
          ),
        ),
      })
      const envelope: unknown = JSON.parse(JSON.stringify({ type: 'state', state }))
      const decoded = decodeStateEnvelope(envelope)
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) throw new Error('Actual Local ordering produced an invalid outgoing state')
      expect(decoded.value.state).toEqual(state)
      expectProject(state, {
        displayOrder: {
          open: [upper, lower].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
          closed: [],
        },
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: PROJECT, mapId: upper }),
        },
      })
    } finally {
      await test.stop()
    }
  })

  // Catches a returning real Local directory keeping obsolete absence above its failed map read.
  it('reports actual Local map read failure after current membership proves reappearance', async () => {
    const test = await localFixture(true)
    const mapPath = join(test.root, FIRST)
    const directory = dirname(mapPath)
    const target = fixtureTicketRef({ project: PROJECT, mapId: FIRST, ticketId: '1' })
    try {
      await test.application.start()
      await rm(directory, { recursive: true })
      await test.refresh(2000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: PROJECT, mapId: SECOND }),
        },
        displayOrder: {
          open: [SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
        maps: expect.arrayContaining([
          expectedMap(FIRST, {
            kind: 'proven-absent',
            absence: { observedAt: 2000, proof: { kind: 'complete-membership' } },
            trace: { kind: 'last-successful-trace', lastSuccessful: { observedAt: 1000 } },
          }),
        ]),
      })
      await mkdir(join(directory, 'tickets'), { recursive: true })
      await writeFile(
        mapPath,
        '---\ntitle: Returned Local map\nlabels: [wayfinder:map]\nstatus: open\n---\n\n## Destination\n\nReturned Local map prose.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n',
      )
      await writeFile(
        join(directory, 'tickets/01-ticket.md'),
        '---\nid: 1\ntitle: Returned Local ticket\nlabels: [wayfinder:task]\nstatus: open\n---\n\nReturned Local ticket prose.\n',
      )
      await utimes(mapPath, 1.5, 1.5)
      await utimes(join(directory, 'tickets/01-ticket.md'), 1.5, 1.5)
      filesystemFailures.set(
        `read:${mapPath}`,
        Object.assign(new Error(SECRET), { code: 'EACCES' }),
      )
      await test.refresh(3000)
      expectProject(readApplicationState(test.application.current()), {
        mapsMembership: {
          kind: 'current-complete',
          observation: {
            observedAt: 3000,
            provenance: {
              integration: 'local',
              path: join(test.root, '.wayfinder'),
              operation: 'enumerate',
            },
            value: {
              members: [
                fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
                fixtureResourceRef({ project: PROJECT, mapId: SECOND }),
              ],
            },
          },
        },
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: [SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
        maps: expect.arrayContaining([
          expectedMap(FIRST, {
            kind: 'retained-unavailable',
            unavailable: {
              scope: { kind: 'map', map: fixtureResourceRef({ project: PROJECT, mapId: FIRST }) },
              attemptedAt: 3000,
              provenance: { integration: 'local', path: mapPath, operation: 'read' },
              failure: { kind: 'filesystem', operation: 'read', code: 'EACCES' },
              cause: 'Source read permission was denied.',
            },
            lastSuccessful: {
              observedAt: 1000,
              provenance: { integration: 'local', path: mapPath, operation: 'read' },
              value: {
                source: { kind: 'file', path: mapPath },
                body: { raw: expect.stringContaining('Actual Local map prose.') },
              },
            },
          }),
        ]),
      })
      expect(
        await test.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target,
            stage: 'classification',
          }),
        ),
      ).toMatchObject({ ok: false })
      await test.enable()
      expect(test.launches).toEqual([])
      expect(readApplicationState(test.application.current()).automation.evidence).toEqual([])
      expect(JSON.stringify(readApplicationState(test.application.current()))).not.toContain(SECRET)
      filesystemFailures.clear()
      await test.refresh(4000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
        },
        displayOrder: {
          open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
        maps: expect.arrayContaining([
          expectedMap(FIRST, {
            kind: 'current-readable',
            observation: {
              observedAt: 4000,
              value: { body: { raw: expect.stringContaining('Returned Local map prose.') } },
            },
          }),
        ]),
      })
    } finally {
      await test.stop()
    }
  })

  // Catches blanket parent-failure demotion and later promotion of replayed old child success.
  it.each(['map-file', 'tickets-directory'] as const)(
    'keeps newly read ticket evidence current during %s failure but retains it after root failure',
    async (location) => {
      const test = await localFixture(true)
      const target = fixtureTicketRef({ project: PROJECT, mapId: FIRST, ticketId: '1' })
      try {
        await test.application.start()
        expect(
          readApplicationState(test.application.current()).automation.overrides,
        ).toContainEqual(
          expect.objectContaining({ target, classification: { status: 'eligible' } }),
        )
        const ticketPath = join(test.root, '.wayfinder/first/tickets/01-ticket.md')
        const parentPath =
          location === 'map-file'
            ? join(test.root, FIRST)
            : join(test.root, '.wayfinder/first/tickets')
        const operation = location === 'map-file' ? 'read' : 'enumerate'
        await writeFile(
          ticketPath,
          '---\nid: 1\ntitle: Updated Local ticket\nlabels: [wayfinder:task]\nstatus: open\n---\n\nIndependently updated ticket prose.\n',
        )
        await utimes(ticketPath, 1.5, 1.5)
        filesystemFailures.set(
          `${operation}:${parentPath}`,
          Object.assign(new Error(SECRET), { code: 'EACCES' }),
        )
        await test.refresh(2000)
        const childSuccess = {
          attemptedAt: 2000,
          observedAt: 2000,
          provenance: { integration: 'local', path: ticketPath, operation: 'read' },
          value: {
            title: 'Updated Local ticket',
            body: expect.stringContaining('Independently updated ticket prose.'),
            source: { kind: 'file', path: ticketPath },
          },
        }
        expectProject(readApplicationState(test.application.current()), {
          activeMap: { kind: 'uncertain' },
          displayOrder: {
            open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
          },
          maps: expect.arrayContaining([
            expectedMap(
              FIRST,
              location === 'map-file'
                ? {
                    kind: 'retained-unavailable',
                    lastSuccessful: { observedAt: 1000 },
                    unavailable: { attemptedAt: 2000, provenance: { path: parentPath, operation } },
                  }
                : {
                    kind: 'current-readable',
                    observation: { observedAt: 2000, completeness: { kind: 'incomplete' } },
                  },
              {
                ticketsMembership:
                  location === 'map-file'
                    ? {
                        kind: 'current-complete',
                        observation: {
                          observedAt: 2000,
                          provenance: {
                            path: join(test.root, '.wayfinder/first/tickets'),
                            operation: 'enumerate',
                          },
                        },
                      }
                    : {
                        kind: 'unavailable',
                        lastComplete: { observedAt: 1000 },
                        unavailable: {
                          attemptedAt: 2000,
                          provenance: { path: parentPath, operation },
                        },
                      },
                tickets: [
                  {
                    ref: fixtureResourceRef({
                      map: { project: PROJECT, mapId: FIRST },
                      ticketId: '1',
                    }),
                    resource: { kind: 'current-readable', observation: childSuccess },
                  },
                ],
              },
            ),
          ]),
        })
        expect(
          await test.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 1,
              target,
              stage: 'classification',
            }),
          ),
        ).toMatchObject({ ok: false })
        expect(readApplicationState(test.application.current()).automation.evidence).toEqual([])
        await test.enable()
        expect(test.launches).toEqual([])
        expect(readApplicationState(test.application.current()).automation.evidence).toEqual([])

        filesystemFailures.clear()
        filesystemFailures.set(
          `enumerate:${test.root}`,
          Object.assign(new Error(SECRET), { code: 'EACCES' }),
        )
        await test.refresh(3000)
        expectProject(readApplicationState(test.application.current()), {
          resource: {
            kind: 'retained-unavailable',
            lastSuccessful: { observedAt: 2000 },
            unavailable: { attemptedAt: 3000 },
          },
          activeMap: { kind: 'uncertain' },
          displayOrder: {
            open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
          },
          maps: expect.arrayContaining([
            expectedMap(
              FIRST,
              { kind: 'retained-unavailable' },
              {
                tickets: [
                  {
                    resource: {
                      kind: 'retained-unavailable',
                      lastSuccessful: childSuccess,
                      unavailable: {
                        scope: { kind: 'project', project: fixtureResourceRef(PROJECT) },
                        attemptedAt: 3000,
                        provenance: { path: test.root, operation: 'inspect-root' },
                      },
                    },
                  },
                ],
              },
            ),
          ]),
        })
        expect(
          await test.application.execute(
            commandSchema.parse({
              type: 'start-automation-override',
              expectedConfigurationVersion: 2,
              target,
              stage: 'classification',
            }),
          ),
        ).toMatchObject({ ok: false })
        expect(readApplicationState(test.application.current()).automation.evidence).toEqual([])
        expect(test.launches).toEqual([])
        expect(JSON.stringify(readApplicationState(test.application.current()))).not.toContain(
          SECRET,
        )
      } finally {
        await test.stop()
      }
    },
  )

  // Catches inherited root/list failures retaining children as fresh or dropping their graph/prose/source.
  it.each([
    { location: 'root', operation: 'enumerate', sourceOperation: 'inspect-root' },
    { location: 'maps-directory', operation: 'enumerate', sourceOperation: 'enumerate' },
    { location: 'map-file', operation: 'read', sourceOperation: 'read' },
    { location: 'tickets-directory', operation: 'enumerate', sourceOperation: 'enumerate' },
    { location: 'ticket-file', operation: 'read', sourceOperation: 'read' },
  ] as const)(
    'retains actual trace and safe scoped evidence after $location failure',
    async ({ location, operation, sourceOperation }) => {
      const test = await localFixture()
      try {
        await test.application.start()
        expectProject(readApplicationState(test.application.current()), {
          activeMap: {
            kind: 'known-current',
            ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
          },
          displayOrder: {
            open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
          },
        })
        const paths = {
          root: test.root,
          'maps-directory': join(test.root, '.wayfinder'),
          'map-file': join(test.root, FIRST),
          'tickets-directory': join(test.root, '.wayfinder/first/tickets'),
          'ticket-file': join(test.root, '.wayfinder/first/tickets/01-ticket.md'),
        }
        const path = paths[location]
        filesystemFailures.set(
          `${operation}:${path}`,
          Object.assign(new Error(SECRET), { code: 'EACCES' }),
        )
        await test.refresh(2000)
        const mapFailed =
          location === 'root' || location === 'maps-directory' || location === 'map-file'
        expectProject(readApplicationState(test.application.current()), {
          activeMap: { kind: 'uncertain' },
          displayOrder: {
            open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
          },
          maps: expect.arrayContaining([
            expectedMap(
              FIRST,
              mapFailed
                ? {
                    kind: 'retained-unavailable',
                    lastSuccessful: {
                      observedAt: 1000,
                      value: {
                        body: { raw: expect.stringContaining('Actual Local map prose.') },
                        source: { kind: 'file', path: join(test.root, FIRST) },
                      },
                    },
                    unavailable: {
                      attemptedAt: 2000,
                      provenance: { path, operation: sourceOperation },
                      failure: { kind: 'filesystem', code: 'EACCES' },
                    },
                  }
                : {
                    kind: 'current-readable',
                    observation: {
                      observedAt: 2000,
                      completeness: { kind: 'incomplete' },
                      value: {
                        body: { raw: expect.stringContaining('Actual Local map prose.') },
                        progress: null,
                      },
                    },
                  },
              {
                tickets: [
                  {
                    ref: fixtureResourceRef({
                      map: { project: PROJECT, mapId: FIRST },
                      ticketId: '1',
                    }),
                    resource:
                      location === 'tickets-directory' || location === 'map-file'
                        ? {
                            kind: 'current-readable',
                            observation: {
                              observedAt: 2000,
                              value: {
                                body: expect.stringContaining('Actual Local ticket prose.'),
                              },
                            },
                          }
                        : {
                            kind: 'retained-unavailable',
                            lastSuccessful: {
                              observedAt: 1000,
                              value: {
                                body: expect.stringContaining('Actual Local ticket prose.'),
                                source: {
                                  kind: 'file',
                                  path: join(test.root, '.wayfinder/first/tickets/01-ticket.md'),
                                },
                              },
                            },
                          },
                  },
                ],
              },
            ),
          ]),
        })
        expect(JSON.stringify(readApplicationState(test.application.current()))).not.toContain(
          SECRET,
        )
        filesystemFailures.clear()
        await test.refresh(3000)
        expectProject(readApplicationState(test.application.current()), {
          activeMap: {
            kind: 'known-current',
            ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
          },
          maps: expect.arrayContaining([
            expectedMap(FIRST, {
              kind: 'current-readable',
              observation: { observedAt: 3000, provenance: { path: join(test.root, FIRST) } },
            }),
          ]),
        })
      } finally {
        await test.stop()
      }
    },
  )

  // Catches known ENOENT being treated as deletion before complete parent membership proves it.
  it('keeps a missing known map file unavailable until its containing directory is completely omitted', async () => {
    const test = await localFixture()
    try {
      await test.application.start()
      await rm(join(test.root, FIRST))
      await test.refresh(2000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: { kind: 'uncertain' },
        maps: expect.arrayContaining([
          expectedMap(FIRST, {
            kind: 'retained-unavailable',
            unavailable: { failure: { kind: 'filesystem', code: 'ENOENT' } },
            lastSuccessful: { observedAt: 1000 },
          }),
        ]),
      })
      await rm(join(test.root, '.wayfinder/first'), { recursive: true })
      await test.refresh(3000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: PROJECT, mapId: SECOND }),
        },
        displayOrder: {
          open: [SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
        maps: expect.arrayContaining([
          expectedMap(FIRST, {
            kind: 'proven-absent',
            absence: { observedAt: 3000, proof: { kind: 'complete-membership' } },
            trace: { kind: 'last-successful-trace', lastSuccessful: { observedAt: 1000 } },
          }),
        ]),
      })
    } finally {
      await test.stop()
    }
  })

  // Catches known ticket ENOENT being called deletion and later incomplete enumeration reviving absence.
  it('requires complete ticket membership for absence and keeps its historical prose through later enumeration failure', async () => {
    const test = await localFixture()
    try {
      await test.application.start()
      const path = join(test.root, '.wayfinder/first/tickets/01-ticket.md')
      filesystemFailures.set(`read:${path}`, Object.assign(new Error(SECRET), { code: 'ENOENT' }))
      await test.refresh(2000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: { kind: 'uncertain' },
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            { kind: 'current-readable' },
            {
              ticketsMembership: { kind: 'current-incomplete' },
              tickets: [
                {
                  resource: {
                    kind: 'retained-unavailable',
                    unavailable: {
                      attemptedAt: 2000,
                      failure: { kind: 'filesystem', operation: 'read', code: 'ENOENT' },
                    },
                    lastSuccessful: {
                      observedAt: 1000,
                      value: { body: expect.stringContaining('Actual Local ticket prose.') },
                    },
                  },
                },
              ],
            },
          ),
        ]),
      })
      filesystemFailures.clear()
      await rm(path)
      await test.refresh(3000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
        },
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            { kind: 'current-readable' },
            {
              ticketsMembership: {
                kind: 'current-complete',
                observation: { value: { members: [] } },
              },
              tickets: [
                {
                  resource: {
                    kind: 'proven-absent',
                    absence: { observedAt: 3000, proof: { kind: 'complete-membership' } },
                    trace: {
                      kind: 'last-successful-trace',
                      lastSuccessful: {
                        observedAt: 1000,
                        value: {
                          source: { kind: 'file', path },
                          body: expect.stringContaining('Actual Local ticket prose.'),
                        },
                      },
                    },
                  },
                },
              ],
            },
          ),
        ]),
      })
      filesystemFailures.set(
        `enumerate:${join(test.root, '.wayfinder/first/tickets')}`,
        Object.assign(new Error(SECRET), { code: 'EACCES' }),
      )
      await test.refresh(4000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: { kind: 'uncertain' },
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            { kind: 'current-readable' },
            {
              tickets: [
                {
                  resource: {
                    kind: 'proven-absent',
                    absence: { observedAt: 3000 },
                    trace: { kind: 'last-successful-trace', lastSuccessful: { observedAt: 1000 } },
                  },
                },
              ],
            },
          ),
        ]),
      })
    } finally {
      await test.stop()
    }
  })

  // Catches unreadable file appearance inventing the prior opaque frontmatter ticket identity.
  it('keeps actual Local ticket absence until a returning file confirms the same readable identity', async () => {
    const test = await localFixture(true)
    const path = join(test.root, '.wayfinder/first/tickets/01-ticket.md')
    const target = fixtureTicketRef({ project: PROJECT, mapId: FIRST, ticketId: '1' })
    try {
      await test.application.start()
      await rm(path)
      await test.refresh(2000)
      const absent = {
        kind: 'proven-absent',
        absence: { observedAt: 2000, proof: { kind: 'complete-membership' } },
        trace: {
          kind: 'last-successful-trace',
          lastSuccessful: {
            observedAt: 1000,
            value: {
              source: { kind: 'file', path },
              body: expect.stringContaining('Actual Local ticket prose.'),
            },
          },
        },
      }
      expectProject(readApplicationState(test.application.current()), {
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            { kind: 'current-readable' },
            {
              ticketsMembership: {
                kind: 'current-complete',
                observation: { value: { members: [] } },
              },
              tickets: [
                {
                  ref: fixtureResourceRef({
                    map: { project: PROJECT, mapId: FIRST },
                    ticketId: '1',
                  }),
                  resource: absent,
                },
              ],
            },
          ),
        ]),
      })
      await writeFile(
        path,
        '---\nid: 1\ntitle: Returned opaque ticket\nlabels: [wayfinder:task]\nstatus: open\n---\n\nReturned readable ticket prose.\n',
      )
      await utimes(path, 1.5, 1.5)
      filesystemFailures.set(`read:${path}`, Object.assign(new Error(SECRET), { code: 'EACCES' }))
      await test.refresh(3000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: { kind: 'uncertain' },
        displayOrder: {
          open: [FIRST, SECOND].map((mapId) => fixtureResourceRef({ project: PROJECT, mapId })),
        },
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            { kind: 'current-readable' },
            {
              ticketsMembership: {
                kind: 'unavailable',
                unavailable: {
                  scope: {
                    kind: 'tickets-membership',
                    map: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
                  },
                  attemptedAt: 3000,
                  provenance: { integration: 'local', path, operation: 'read' },
                  failure: { kind: 'filesystem', operation: 'read', code: 'EACCES' },
                  cause: 'Source read permission was denied.',
                },
              },
              tickets: [
                {
                  ref: fixtureResourceRef({
                    map: { project: PROJECT, mapId: FIRST },
                    ticketId: '1',
                  }),
                  resource: absent,
                },
              ],
            },
          ),
        ]),
      })
      expect(
        await test.application.execute(
          commandSchema.parse({
            type: 'start-automation-override',
            expectedConfigurationVersion: 1,
            target,
            stage: 'classification',
          }),
        ),
      ).toMatchObject({ ok: false })
      await test.enable()
      expect(test.launches).toEqual([])
      expect(readApplicationState(test.application.current()).automation.evidence).toEqual([])
      expect(JSON.stringify(readApplicationState(test.application.current()))).not.toContain(SECRET)
      filesystemFailures.clear()
      await test.refresh(4000)
      expectProject(readApplicationState(test.application.current()), {
        activeMap: {
          kind: 'known-current',
          ref: fixtureResourceRef({ project: PROJECT, mapId: FIRST }),
        },
        maps: expect.arrayContaining([
          expectedMap(
            FIRST,
            { kind: 'current-readable' },
            {
              ticketsMembership: {
                kind: 'current-complete',
                observation: {
                  observedAt: 4000,
                  value: {
                    members: [
                      fixtureResourceRef({
                        map: { project: PROJECT, mapId: FIRST },
                        ticketId: '1',
                      }),
                    ],
                  },
                },
              },
              tickets: [
                {
                  ref: fixtureResourceRef({
                    map: { project: PROJECT, mapId: FIRST },
                    ticketId: '1',
                  }),
                  resource: {
                    kind: 'current-readable',
                    observation: {
                      observedAt: 4000,
                      value: { body: expect.stringContaining('Returned readable ticket prose.') },
                    },
                  },
                },
              ],
            },
          ),
        ]),
      })
    } finally {
      await test.stop()
    }
  })
})
