import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoadmapApplication, type RoadmapApplication } from './application/application.ts'
import { createApplicationOperations } from './application/operations.ts'
import type { ConfigurationDocument } from './configuration/document.ts'
import { createLocalObserver } from './local/observer.ts'
import {
  absentAttempt,
  failedAttempt,
  type ObservationBatch,
  observedAttempt,
  refineObservationAttempt,
  type SourceObservationHealth,
} from './observation/source.ts'
import type { ProjectConfiguration } from './projects/registry.ts'
import { fixtureResourceRef, readApplicationState } from './public-test-fixtures.ts'
import {
  controlledSourceFixture,
  createFixtureReadSequence,
  createSourceFixtureOwner,
  type FixtureProject,
  fixtureAdmissions,
  publicProjectObservation,
} from './source-test-fixtures.ts'

const roots: string[] = []
const applications: RoadmapApplication[] = []
const PRIMARY_MAP_ID = '.wayfinder/primary/map.md'
const SECONDARY_MAP_ID = '.wayfinder/secondary/map.md'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
})

afterEach(async () => {
  try {
    await Promise.all(applications.splice(0).map((application) => application.stop()))
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  } finally {
    vi.useRealTimers()
  }
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-source-evidence-'))
  roots.push(root)
  return root
}

function configuration(root: string, id: string): ConfigurationDocument {
  const document: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: [
      {
        ref: { integration: 'local', projectId: id },
        connectionId: 'local',
        workspace: { path: root },
      },
    ],
    automation: { enabled: false, enabledProjects: [] },
  }
  return {
    async load() {
      return { ok: true, document }
    },
    subscribe() {
      return () => undefined
    },
    async write() {
      throw new Error('Source evidence tests do not mutate configuration')
    },
    async stop() {},
  }
}

async function startApplication(
  root: string,
  id = 'opaque/local-project',
): Promise<RoadmapApplication> {
  const application = createRoadmapApplication({
    configuration: configuration(root, id),
    admissions: fixtureAdmissions,
    observers: {
      local: (input) =>
        createLocalObserver(input, {
          reconcileMs: 100,
          watchDirectory: () => ({ close() {} }),
          logger: { info() {}, warn() {} },
        }),
      github() {
        throw new Error('Unused source')
      },
    },
    serverEpoch: 'source-evidence-test',
  })
  applications.push(application)
  await application.start()
  return application
}

async function writeMap(
  root: string,
  id: string,
  destination: string,
  sourceTime: number,
): Promise<void> {
  const directory = join(root, '.wayfinder', id)
  const tickets = join(directory, 'tickets')
  await mkdir(tickets, { recursive: true })
  await writeFile(
    join(directory, 'map.md'),
    `---\ntitle: ${id}\nlabels: [wayfinder:map]\nstatus: open\n---\n\n# ${id}\n\n## Destination\n\n${destination}\n\n## Notes\n\n- Preserve this source trace.\n\n## Decisions so far\n\n## Not yet specified\n\n- Read uncertainty.\n\n## Out of scope\n\n- Trace deletion.\n`,
  )
  await writeFile(
    join(tickets, '1.md'),
    `---\nid: 1\ntitle: Read evidence\nlabels: [wayfinder:task]\nstatus: open\nblocked_by: []\n---\n\n# Read evidence\n\nTicket prose for ${id}.\n`,
  )
  await Promise.all([
    utimes(join(directory, 'map.md'), sourceTime, sourceTime),
    utimes(join(tickets, '1.md'), sourceTime, sourceTime),
  ])
}

async function reconcile(application: RoadmapApplication, time = 2_000): Promise<void> {
  const previousSequence = readApplicationState(application.current()).stateSequence
  let unsubscribe = () => {}
  const published = new Promise<void>((resolve) => {
    unsubscribe = application.subscribe((state) => {
      if (state.stateSequence > previousSequence) resolve()
    })
  })
  try {
    vi.setSystemTime(time)
    await vi.advanceTimersByTimeAsync(100)
    await published
  } finally {
    unsubscribe()
  }
}

async function controlledEvidenceApplication() {
  const local: FixtureProject = {
    key: { integration: 'local', id: 'local-evidence' },
    name: 'Local evidence',
    sourcePath: '/tmp/local-evidence',
    openMaps: [],
    closedMaps: [],
    warnings: [],
  }
  const github: FixtureProject = {
    key: { integration: 'github', id: 'remote-evidence' },
    name: 'acme/remote',
    sourceUrl: 'https://github.com/acme/remote',
    openMaps: [],
    closedMaps: [],
    warnings: [],
  }
  let remoteHealth: SourceObservationHealth = { status: 'available', observedAt: 900 }
  const document: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [
      { id: 'local', integration: 'local', name: 'Local', builtIn: true },
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
        ref: { integration: 'local', projectId: local.key.id },
        connectionId: 'local',
        workspace: { path: '/tmp/local-evidence' },
      },
      {
        ref: { integration: 'github', projectId: github.key.id },
        connectionId: 'github',
        locator: { repositoryId: 'remote-evidence', nameWithOwner: 'acme/remote' },
        workspace: { path: '/tmp/remote-evidence' },
      },
    ],
    automation: { enabled: false, enabledProjects: [] },
  }
  const readLocal = createSourceFixtureOwner()
  const readGitHub = createSourceFixtureOwner()
  const localControl = controlledSourceFixture(local.key, readLocal([local], 800, document))
  const remoteControl = controlledSourceFixture(github.key, readGitHub([github], 900, document))
  const states: ReadyApplicationState[] = []
  const application = createRoadmapApplication({
    configuration: {
      async load() {
        return { ok: true, document }
      },
      subscribe() {
        return () => undefined
      },
      async write() {
        throw new Error('Evidence schedules do not mutate configuration')
      },
      async stop() {},
    },
    admissions: fixtureAdmissions,
    operations: createApplicationOperations(),
    observers: { local: () => localControl.observer, github: () => remoteControl.observer },
    serverEpoch: 'controlled-source-evidence',
  })
  applications.push(application)
  application.subscribe((state) => states.push(readApplicationState(state)))
  await application.start()
  return {
    application,
    states,
    local,
    github,
    configuration: document,
    readLocal,
    readGitHub,
    localControl,
    push(integration: 'local' | 'github', batch: ObservationBatch) {
      if (integration === 'local') localControl.push(batch)
      else remoteControl.push(batch, remoteHealth)
    },
    setGitHubAvailability(health: SourceObservationHealth) {
      remoteHealth = health
    },
  }
}
function sourceTime(state: ReadyApplicationState, integration: 'local' | 'github') {
  const project = state.projects.find((project) => project.ref.integration === integration)
  return project ? publicProjectObservation(project)?.observedAt : undefined
}

describe('source evidence through RoadmapApplication', () => {
  it('advances only the successfully observed source when unchanged content is read again', async () => {
    const controlled = await controlledEvidenceApplication()
    const { application, local, github, states, configuration } = controlled
    vi.setSystemTime(2_000)
    controlled.push(
      'local',
      controlled.readLocal([{ ...local, warnings: ['Local-only content change.'] }], 1_800),
    )
    expect(sourceTime(readApplicationState(application.current()), 'local')).toBe(1_800)
    expect(sourceTime(readApplicationState(application.current()), 'github')).toBe(900)
    expect(application.current().capturedAt).toBe(2_000)

    vi.setSystemTime(3_000)
    controlled.push('github', controlled.readGitHub([github], 2_500, configuration))
    expect(sourceTime(readApplicationState(application.current()), 'github')).toBe(2_500)
    expect(sourceTime(readApplicationState(application.current()), 'local')).toBe(1_800)
    expect(
      readApplicationState(application.current()).connections.find(
        (connection) => connection.id === 'github',
      )?.availability.observedAt,
    ).toBe(900)
    expect(application.current().capturedAt).toBe(3_000)
    expect(
      states.map((state) => ({
        publication: state.capturedAt,
        local: sourceTime(state, 'local'),
        github: sourceTime(state, 'github'),
      })),
    ).toEqual([
      { publication: 1_000, local: 800, github: 900 },
      { publication: 2_000, local: 1_800, github: 900 },
      { publication: 3_000, local: 1_800, github: 2_500 },
    ])
    for (const state of states) {
      expect(state.projects.find((project) => project.ref.integration === 'github')).toMatchObject({
        ref: fixtureResourceRef({ integration: 'github', id: 'remote-evidence' }),
        name: 'acme/remote',
      })
    }
  })

  it('retains successful source time until ordinary recovery commits its unchanged replacement content', async () => {
    const controlled = await controlledEvidenceApplication()
    const { application, local, github, states, configuration } = controlled
    vi.setSystemTime(2_000)
    controlled.setGitHubAvailability({
      status: 'unavailable',
      cause: 'Provider read failed.',
      observedAt: 900,
    })
    controlled.push('github', {
      attempts: [
        {
          kind: 'failed',
          readSequence: controlled.readGitHub.nextReadSequence(),
          scope: { kind: 'project', project: github.key },
          attemptedAt: 1_900,
          provenance: {
            integration: 'github',
            connectionId: 'github',
            repositoryId: 'remote-evidence',
            stage: 'repository',
          },
          failure: { kind: 'read', cause: 'response-read' },
        },
      ],
    })
    vi.setSystemTime(3_000)
    controlled.setGitHubAvailability({ status: 'available', observedAt: 2_900 })
    controlled.push(
      'local',
      controlled.readLocal(
        [{ ...local, warnings: ['Independent Local observation during recovery.'] }],
        2_800,
      ),
    )

    const beforeRecovery = readApplicationState(application.current()).projects.find(
      (project) => project.ref.integration === 'github',
    )
    expect(beforeRecovery).toMatchObject({
      name: 'acme/remote',
      resource: {
        kind: 'retained-unavailable',
        lastSuccessful: { observedAt: 900 },
        unavailable: { attemptedAt: 1_900, failure: { kind: 'read', cause: 'response-read' } },
      },
      activeMap: { kind: 'uncertain' },
    })
    expect(
      readApplicationState(application.current()).projects.find(
        (project) => project.ref.integration === 'local',
      )?.resource.kind,
    ).toBe('current-readable')
    for (const state of states.slice(1)) {
      expect(state.projects.find((project) => project.ref.integration === 'github')).toMatchObject({
        name: 'acme/remote',
        resource: { kind: 'retained-unavailable', lastSuccessful: { observedAt: 900 } },
        activeMap: { kind: 'uncertain' },
      })
      expect(sourceTime(state, 'github')).toBe(900)
    }

    const recoveryBoundary = states.length
    vi.setSystemTime(4_000)
    const recovery = controlled.readGitHub([github], 3_800, configuration)
    controlled.push('github', {
      attempts: recovery.attempts.map((attempt) =>
        attempt.kind === 'observed' && attempt.scope.kind === 'maps-membership'
          ? { ...attempt, attemptedAt: 2_900, observedAt: 2_900 }
          : attempt,
      ),
    })
    expect(states.length).toBeGreaterThan(recoveryBoundary)
    for (const state of states.slice(recoveryBoundary)) {
      expect(state.projects.find((project) => project.ref.integration === 'github')).toMatchObject({
        ref: fixtureResourceRef({ integration: 'github', id: 'remote-evidence' }),
        name: 'acme/remote',
        resource: {
          kind: 'current-readable',
          observation: { observedAt: 3_800, value: { name: 'acme/remote' } },
        },
        mapsMembership: { kind: 'current-complete', observation: { observedAt: 2_900 } },
        activeMap: { kind: 'known-empty' },
      })
      expect(state.capturedAt).toBe(4_000)
      expect(sourceTime(state, 'local')).toBe(2_800)
      expect(
        state.connections.find((connection) => connection.id === 'github')?.availability.observedAt,
      ).toBe(2_900)
    }
  })

  it('retains an unreadable active map while committing an independently readable sibling', async () => {
    const root = await workspace()
    await writeMap(root, 'primary', 'Original primary prose.', 200)
    await writeMap(root, 'secondary', 'Original secondary prose.', 100)
    const application = await startApplication(root)
    expect(
      readApplicationState(application.current()).projects[0]?.displayOrder.open.map(
        (ref) => ref.mapId,
      ),
    ).toEqual([PRIMARY_MAP_ID, SECONDARY_MAP_ID])

    await rm(join(root, '.wayfinder', 'primary', 'map.md'))
    await mkdir(join(root, '.wayfinder', 'primary', 'map.md'))
    await writeMap(root, 'secondary', 'Updated secondary prose.', 300)
    await reconcile(application)

    const project = readApplicationState(application.current()).projects[0]
    expect(project).toMatchObject({
      resource: { kind: 'current-readable', observation: { observedAt: 2_100 } },
      activeMap: { kind: 'uncertain' },
      displayOrder: {
        open: [PRIMARY_MAP_ID, SECONDARY_MAP_ID].map((mapId) =>
          fixtureResourceRef({
            project: { integration: 'local', id: 'opaque/local-project' },
            mapId,
          }),
        ),
      },
    })
    expect(project?.maps.find((map) => map.ref.mapId === PRIMARY_MAP_ID)).toMatchObject({
      resource: {
        kind: 'retained-unavailable',
        lastSuccessful: {
          observedAt: 1_000,
          value: {
            body: { destination: 'Original primary prose.' },
            source: { kind: 'file', path: join(root, '.wayfinder', 'primary', 'map.md') },
          },
        },
        unavailable: {
          kind: 'source-failure',
          scope: { kind: 'map' },
          attemptedAt: 2_100,
          failure: { kind: 'filesystem', operation: 'read' },
        },
      },
      tickets: [
        expect.objectContaining({
          ref: fixtureResourceRef({
            map: {
              project: { integration: 'local', id: 'opaque/local-project' },
              mapId: PRIMARY_MAP_ID,
            },
            ticketId: '1',
          }),
          resource: {
            kind: 'current-readable',
            observation: expect.objectContaining({
              observedAt: 2_100,
              value: expect.objectContaining({
                body: expect.stringContaining('Ticket prose for primary.'),
              }),
            }),
          },
        }),
      ],
    })
    expect(project?.maps.find((map) => map.ref.mapId === SECONDARY_MAP_ID)?.resource).toMatchObject(
      {
        kind: 'current-readable',
        observation: {
          observedAt: 2_100,
          value: { body: { destination: 'Updated secondary prose.' } },
        },
      },
    )
  })

  it('distinguishes never-read map membership from a readable complete empty directory', async () => {
    const unreadableRoot = await workspace()
    await writeFile(join(unreadableRoot, '.wayfinder'), 'This is not a directory.')
    const emptyRoot = await workspace()
    await mkdir(join(emptyRoot, '.wayfinder'))

    const unreadable = await startApplication(unreadableRoot, 'never-read')
    const empty = await startApplication(emptyRoot, 'readable-empty')

    expect(readApplicationState(unreadable.current()).projects[0]).toMatchObject({
      resource: { kind: 'current-readable', observation: { observedAt: 1_000 } },
      mapsMembership: {
        kind: 'unavailable',
        lastComplete: null,
        unavailable: { kind: 'source-failure', scope: { kind: 'maps-membership' } },
      },
      maps: [],
      activeMap: { kind: 'uncertain' },
    })
    expect(readApplicationState(empty.current()).projects[0]).toMatchObject({
      resource: { kind: 'current-readable', observation: { observedAt: 1_000 } },
      mapsMembership: { kind: 'current-complete', observation: { value: { members: [] } } },
      maps: [],
      activeMap: { kind: 'known-empty' },
    })
  })

  it('does not turn failed map-directory enumeration into a fresh empty Project', async () => {
    const root = await workspace()
    await writeMap(root, 'primary', 'Retain directory failure prose.', 200)
    const application = await startApplication(root)

    await rm(join(root, '.wayfinder'), { recursive: true })
    await writeFile(join(root, '.wayfinder'), 'Enumeration cannot succeed.')
    await reconcile(application)

    const project = readApplicationState(application.current()).projects[0]
    expect(project).toMatchObject({
      resource: { kind: 'current-readable', observation: { observedAt: 2_100 } },
      mapsMembership: { kind: 'unavailable', lastComplete: { observedAt: 1_000 } },
      activeMap: { kind: 'uncertain' },
      displayOrder: {
        open: [PRIMARY_MAP_ID].map((mapId) =>
          fixtureResourceRef({
            project: { integration: 'local', id: 'opaque/local-project' },
            mapId,
          }),
        ),
      },
    })
    expect(project?.maps.find((map) => map.ref.mapId === PRIMARY_MAP_ID)?.resource).toMatchObject({
      kind: 'retained-unavailable',
      lastSuccessful: {
        observedAt: 1_000,
        value: { body: { destination: 'Retain directory failure prose.' } },
      },
      unavailable: { kind: 'source-failure', scope: { kind: 'maps-membership' } },
    })
  })

  it('preserves historical map and ticket trace after complete scoped membership proves absence', async () => {
    const root = await workspace()
    await writeMap(root, 'primary', 'Historical map prose.', 200)
    const application = await startApplication(root)

    await rm(join(root, '.wayfinder', 'primary'), { recursive: true })
    await reconcile(application)

    const project = readApplicationState(application.current()).projects[0]
    const retained = project?.maps.find((map) => map.ref.mapId === PRIMARY_MAP_ID)
    expect(project).toMatchObject({
      activeMap: { kind: 'known-empty' },
      displayOrder: {
        open: [].map((mapId) =>
          fixtureResourceRef({
            project: { integration: 'local', id: 'opaque/local-project' },
            mapId,
          }),
        ),
      },
      mapsMembership: { kind: 'current-complete', observation: { value: { members: [] } } },
    })
    expect(retained).toMatchObject({
      ref: fixtureResourceRef({
        project: { integration: 'local', id: 'opaque/local-project' },
        mapId: PRIMARY_MAP_ID,
      }),
      resource: {
        kind: 'proven-absent',
        absence: { observedAt: 2_100, proof: { kind: 'complete-membership' } },
        trace: {
          kind: 'last-successful-trace',
          lastSuccessful: {
            observedAt: 1_000,
            value: {
              body: { destination: 'Historical map prose.' },
              source: { kind: 'file', path: join(root, '.wayfinder', 'primary', 'map.md') },
            },
          },
        },
      },
      tickets: [
        expect.objectContaining({
          ref: fixtureResourceRef({
            ticketId: '1',
            map: {
              project: { integration: 'local', id: 'opaque/local-project' },
              mapId: PRIMARY_MAP_ID,
            },
          }),
          resource: expect.objectContaining({
            kind: 'retained-unavailable',
            lastSuccessful: expect.objectContaining({
              observedAt: 1_000,
              value: expect.objectContaining({
                body: expect.stringContaining('Ticket prose for primary.'),
              }),
            }),
          }),
        }),
      ],
    })
  })

  it('revalidates the same opaque identity after unreadable map content recovers', async () => {
    const root = await workspace()
    await writeMap(root, 'primary', 'Before read failure.', 200)
    const application = await startApplication(root)

    await rm(join(root, '.wayfinder', 'primary', 'map.md'))
    await mkdir(join(root, '.wayfinder', 'primary', 'map.md'))
    await reconcile(application)
    expect(readApplicationState(application.current()).projects[0]).toMatchObject({
      activeMap: { kind: 'uncertain' },
      maps: [
        expect.objectContaining({
          resource: expect.objectContaining({
            kind: 'retained-unavailable',
            lastSuccessful: expect.objectContaining({ observedAt: 1_000 }),
          }),
        }),
      ],
    })

    await rm(join(root, '.wayfinder', 'primary', 'map.md'), { recursive: true })
    await writeMap(root, 'primary', 'Recovered map prose.', 400)
    await reconcile(application, 3_000)

    const recovered = readApplicationState(application.current()).projects[0]
    expect(recovered).toMatchObject({
      ref: { integration: 'local', projectId: 'opaque/local-project' },
      resource: { kind: 'current-readable', observation: { observedAt: 3_100 } },
      activeMap: {
        kind: 'known-current',
        ref: fixtureResourceRef({
          project: { integration: 'local', id: 'opaque/local-project' },
          mapId: PRIMARY_MAP_ID,
        }),
      },
    })
    expect(recovered?.maps.find((map) => map.ref.mapId === PRIMARY_MAP_ID)?.resource).toMatchObject(
      {
        kind: 'current-readable',
        observation: {
          observedAt: 3_100,
          value: { body: { destination: 'Recovered map prose.' } },
        },
      },
    )
  })
})

describe('source attempt refinement', () => {
  const project = { integration: 'local', id: 'opaque' } as const
  const other = { integration: 'local', id: 'other' } as const
  const provenance = { integration: 'local', path: '/tmp/opaque', operation: 'enumerate' } as const
  const nextReadSequence = createFixtureReadSequence()
  const membership = {
    kind: 'observed',
    readSequence: nextReadSequence(),
    scope: { kind: 'maps-membership', project },
    attemptedAt: 10,
    observedAt: 20,
    provenance,
    completeness: { kind: 'complete' },
    value: { members: [{ project, mapId: '.wayfinder/map/map.md' }] },
  } as const
  const failure = {
    kind: 'failed',
    scope: { kind: 'maps-membership', project },
    readSequence: nextReadSequence(),
    attemptedAt: 10,
    provenance,
    failure: { kind: 'filesystem', operation: 'enumerate', code: 'EACCES' },
  } as const
  const absence = {
    kind: 'proven-absent',
    scope: { kind: 'map', map: membership.value.members[0] },
    readSequence: membership.readSequence,
    attemptedAt: membership.attemptedAt,
    observedAt: membership.observedAt,
    provenance,
    proof: { kind: 'complete-membership', parent: membership.scope },
  } as const

  it.each([
    { kind: 'observed', attempt: membership },
    { kind: 'failed', attempt: failure },
    { kind: 'proven-absent', attempt: absence },
  ])('requires explicit positive safe-integer read identity for $kind evidence', ({ attempt }) => {
    expect(refineObservationAttempt(attempt)).toEqual(attempt)
    const { readSequence: _readSequence, ...missingSequence } = attempt
    expect(refineObservationAttempt(missingSequence)).toBeNull()
    for (const readSequence of [
      undefined,
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Infinity,
      '1',
      null,
    ]) {
      expect(refineObservationAttempt({ ...attempt, readSequence })).toBeNull()
    }
  })

  it('constructors preserve supplied read identity instead of allocating another operation', () => {
    const observed = { ...membership, readSequence: Number.MAX_SAFE_INTEGER }
    const failed = { ...failure, readSequence: 42 }
    const absent = { ...absence, readSequence: membership.readSequence }
    expect(observedAttempt(observed)).toBe(observed)
    expect(observedAttempt(observed)).toBe(observed)
    expect(failedAttempt(failed)).toBe(failed)
    expect(absentAttempt(absent)).toBe(absent)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity])(
    'constructors reject invalid read identity %s',
    (readSequence) => {
      expect(() => observedAttempt({ ...membership, readSequence })).toThrow()
      expect(() => failedAttempt({ ...failure, readSequence })).toThrow()
      expect(() => absentAttempt({ ...absence, readSequence })).toThrow()
    },
  )

  it('refuses malformed scope identities rather than creating named failures', () => {
    expect(
      refineObservationAttempt({
        ...membership,
        scope: { kind: 'maps-membership', project: { integration: 'local', id: '' } },
      }),
    ).toBeNull()
    expect(
      refineObservationAttempt({
        ...membership,
        value: { members: [{ project: other, mapId: '.wayfinder/map/map.md' }] },
      }),
    ).toBeNull()
    expect(
      refineObservationAttempt({
        ...membership,
        value: { members: [...membership.value.members, ...membership.value.members] },
      }),
    ).toBeNull()
  })

  it('accepts complete empty membership without claiming aggregate absence', () => {
    expect(refineObservationAttempt({ ...membership, value: { members: [] } })?.kind).toBe(
      'observed',
    )
    expect(
      refineObservationAttempt({
        ...membership,
        kind: 'proven-absent',
        proof: { kind: 'complete-membership', parent: membership.scope },
      }),
    ).toBeNull()
  })

  it('refuses unrelated parent absence proofs and invented successful times', () => {
    expect(
      refineObservationAttempt({
        kind: 'proven-absent',
        readSequence: membership.readSequence,
        scope: { kind: 'map', map: membership.value.members[0] },
        attemptedAt: 10,
        observedAt: 20,
        provenance,
        proof: { kind: 'complete-membership', parent: { kind: 'maps-membership', project: other } },
      }),
    ).toBeNull()
    expect(refineObservationAttempt({ ...membership, observedAt: Number.NaN })).toBeNull()
    expect(refineObservationAttempt({ ...membership, observedAt: 9 })).toBeNull()
  })

  it('rejects raw provider diagnostics in failed source evidence', () => {
    expect(
      refineObservationAttempt({
        kind: 'failed',
        readSequence: nextReadSequence(),
        scope: { kind: 'project', project: { integration: 'github', id: 'opaque' } },
        attemptedAt: 10,
        provenance: {
          integration: 'github',
          connectionId: 'github',
          repositoryId: '42',
          stage: 'repository',
        },
        failure: { kind: 'execution', cause: 'provider', message: 'unsafe provider response' },
      }),
    ).toBeNull()
  })

  it('does not certify unknown fields in otherwise valid observed content', () => {
    expect(
      refineObservationAttempt({
        ...membership,
        value: { ...membership.value, providerResponse: 'credential-secret' },
      }),
    ).toBeNull()
    expect(
      refineObservationAttempt({
        ...membership,
        completeness: { kind: 'complete', providerResponse: 'credential-secret' },
      }),
    ).toBeNull()
  })
})
