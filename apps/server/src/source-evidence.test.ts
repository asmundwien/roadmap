import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoadmapApplication, type RoadmapApplication } from './application/application.ts'
import type { ConfigurationDocument, RoadmapConfiguration } from './application/configuration.ts'
import { createLocalAdapter } from './local/adapter.ts'
import { refineObservationAttempt } from './observation/source.ts'

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
  const document: RoadmapConfiguration = {
    schemaVersion: 5,
    configurationVersion: 1,
    connections: [{ id: 'local', integration: 'local', name: 'Local', builtIn: true }],
    projects: [
      {
        key: { integration: 'local', id },
        connectionId: 'local',
        locator: { integration: 'local', path: root },
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
    createAdapters: (document) => [
      createLocalAdapter({
        sources: document.projects.flatMap((registration) =>
          registration.key.integration === 'local'
            ? [
                {
                  key: { integration: 'local' as const, id: registration.key.id },
                  rootPath: registration.workspace.path,
                },
              ]
            : [],
        ),
        reconcileMs: 100,
        watchDirectory: () => ({ close() {} }),
        logger: { info() {}, warn() {} },
      }),
    ],
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
  const previousSequence = application.current().stateSequence
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

describe('source evidence through RoadmapApplication', () => {
  it('retains an unreadable active map while committing an independently readable sibling', async () => {
    const root = await workspace()
    await writeMap(root, 'primary', 'Original primary prose.', 200)
    await writeMap(root, 'secondary', 'Original secondary prose.', 100)
    const application = await startApplication(root)
    expect(application.current().projects[0]?.openMaps.map((map) => map.id)).toEqual([
      PRIMARY_MAP_ID,
      SECONDARY_MAP_ID,
    ])

    await rm(join(root, '.wayfinder', 'primary', 'map.md'))
    await mkdir(join(root, '.wayfinder', 'primary', 'map.md'))
    await writeMap(root, 'secondary', 'Updated secondary prose.', 300)
    await reconcile(application)

    const project = application.current().projects[0]
    expect(project?.availability).toMatchObject({ status: 'unavailable', observedAt: 1_000 })
    expect(project?.openMaps.map((map) => map.id)).toEqual([PRIMARY_MAP_ID, SECONDARY_MAP_ID])
    expect(project?.openMaps.find((map) => map.id === PRIMARY_MAP_ID)).toMatchObject({
      body: { destination: 'Original primary prose.' },
      tickets: [
        expect.objectContaining({
          id: '1',
          body: expect.stringContaining('Ticket prose for primary.'),
        }),
      ],
      sourcePath: join(root, '.wayfinder', 'primary', 'map.md'),
    })
    expect(project?.openMaps.find((map) => map.id === SECONDARY_MAP_ID)?.body.destination).toBe(
      'Updated secondary prose.',
    )
    expect(application.current().roadmap.unreachable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          project: { integration: 'local', id: 'opaque/local-project' },
          mapId: PRIMARY_MAP_ID,
        }),
      ]),
    )
    expect(
      application
        .current()
        .roadmap.projects.flatMap((entry) => entry.openMaps)
        .map((map) => map.id),
    ).not.toContain(PRIMARY_MAP_ID)
  })

  it('distinguishes never-read map membership from a readable complete empty directory', async () => {
    const unreadableRoot = await workspace()
    await writeFile(join(unreadableRoot, '.wayfinder'), 'This is not a directory.')
    const emptyRoot = await workspace()
    await mkdir(join(emptyRoot, '.wayfinder'))

    const unreadable = await startApplication(unreadableRoot, 'never-read')
    const empty = await startApplication(emptyRoot, 'readable-empty')

    expect(unreadable.current().projects[0]?.availability.status).toBe('unavailable')
    expect(unreadable.current().projects[0]?.availability.observedAt).toBeUndefined()
    expect(unreadable.current().projects[0]?.openMaps).toEqual([])
    expect(unreadable.current().roadmap.unreachable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ project: { integration: 'local', id: 'never-read' } }),
      ]),
    )
    expect(empty.current().projects[0]?.availability).toEqual({
      status: 'available',
      observedAt: 1_000,
    })
    expect(empty.current().projects[0]?.openMaps).toEqual([])
    expect(empty.current().roadmap.unreachable).toEqual([])
  })

  it('does not turn failed map-directory enumeration into a fresh empty Project', async () => {
    const root = await workspace()
    await writeMap(root, 'primary', 'Retain directory failure prose.', 200)
    const application = await startApplication(root)

    await rm(join(root, '.wayfinder'), { recursive: true })
    await writeFile(join(root, '.wayfinder'), 'Enumeration cannot succeed.')
    await reconcile(application)

    const project = application.current().projects[0]
    expect(project?.availability).toMatchObject({ status: 'unavailable', observedAt: 1_000 })
    expect(project?.openMaps.find((map) => map.id === PRIMARY_MAP_ID)?.body.destination).toBe(
      'Retain directory failure prose.',
    )
    expect(application.current().roadmap.projects).toEqual([])
  })

  it('preserves historical map and ticket trace after complete scoped membership proves absence', async () => {
    const root = await workspace()
    await writeMap(root, 'primary', 'Historical map prose.', 200)
    const application = await startApplication(root)

    await rm(join(root, '.wayfinder', 'primary'), { recursive: true })
    await reconcile(application)

    const retained = application
      .current()
      .projects[0]?.openMaps.find((map) => map.id === PRIMARY_MAP_ID)
    expect(retained).toMatchObject({
      id: PRIMARY_MAP_ID,
      body: { destination: 'Historical map prose.' },
      tickets: [
        expect.objectContaining({
          id: '1',
          body: expect.stringContaining('Ticket prose for primary.'),
        }),
      ],
      sourcePath: join(root, '.wayfinder', 'primary', 'map.md'),
    })
    expect(application.current().roadmap.projects.flatMap((project) => project.openMaps)).toEqual(
      [],
    )
    expect(application.current().roadmap.unreachable).toEqual(
      expect.arrayContaining([expect.objectContaining({ mapId: PRIMARY_MAP_ID })]),
    )
  })

  it('revalidates the same opaque identity after unreadable map content recovers', async () => {
    const root = await workspace()
    await writeMap(root, 'primary', 'Before read failure.', 200)
    const application = await startApplication(root)

    await rm(join(root, '.wayfinder', 'primary', 'map.md'))
    await mkdir(join(root, '.wayfinder', 'primary', 'map.md'))
    await reconcile(application)
    expect(application.current().projects[0]?.availability).toMatchObject({
      status: 'unavailable',
      observedAt: 1_000,
    })

    await rm(join(root, '.wayfinder', 'primary', 'map.md'), { recursive: true })
    await writeMap(root, 'primary', 'Recovered map prose.', 400)
    await reconcile(application, 3_000)

    const recovered = application.current().projects[0]
    expect(recovered).toMatchObject({
      key: { integration: 'local', id: 'opaque/local-project' },
      availability: { status: 'available', observedAt: 3_100 },
    })
    expect(recovered?.openMaps.find((map) => map.id === PRIMARY_MAP_ID)?.body.destination).toBe(
      'Recovered map prose.',
    )
    expect(application.current().roadmap.unreachable).toEqual([])
  })
})

describe('source attempt refinement', () => {
  const project = { integration: 'local', id: 'opaque' } as const
  const other = { integration: 'local', id: 'other' } as const
  const provenance = { integration: 'local', path: '/tmp/opaque', operation: 'enumerate' } as const
  const membership = {
    kind: 'observed',
    scope: { kind: 'maps-membership', project },
    attemptedAt: 10,
    observedAt: 20,
    provenance,
    completeness: { kind: 'complete' },
    value: { members: [{ project, mapId: '.wayfinder/map/map.md' }] },
  } as const

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
