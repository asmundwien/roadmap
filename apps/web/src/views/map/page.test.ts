import {
  connectionIdSchema,
  githubProjectRefSchema,
  mapIdSchema,
  projectIdSchema,
  ticketIdSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import type { MapResource, Project, TicketResource } from '@roadmap/contracts/state'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App } from '@/App'
import { resourceObservation } from '@/resources/results'
import { mapPath, projectPath, ticketPath } from '@/router'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import { mapGraph } from './graph'
import {
  blocker,
  makeApplicationState,
  makeMap,
  makeRoadmapSnapshot,
  makeRoadmapStore,
  ticket,
} from './test-fixtures'

function project(maps: MapResource[]): Project {
  const key = githubProjectRefSchema.parse({
    integration: 'github',
    projectId: projectIdSchema.parse('project-home'),
  })
  return {
    integration: 'github',
    ref: key,
    connectionId: connectionIdSchema.parse('connection-home'),
    source: {
      integration: 'github',
      repositoryId: key.projectId,
      nameWithOwner: 'me/repo',
      url: 'https://example.test/me/repo',
    },
    management: { workspacePath: '/workspace' },
    name: 'Configured project',
    actions: [],
    managementWarnings: [],
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'project', project: key },
        attemptedAt: 0,
        observedAt: 0,
        provenance: {
          integration: 'github',
          connectionId: connectionIdSchema.parse('connection-home'),
          repositoryId: key.projectId,
          stage: 'repository',
        },
        completeness: { kind: 'complete' },
        value: {
          name: 'Source project',
          source: {
            integration: 'github',
            repositoryId: key.projectId,
            nameWithOwner: 'me/repo',
            url: 'https://example.test/me/repo',
          },
          warnings: [],
        },
      },
    },
    mapsMembership: {
      kind: 'current-complete',
      observation: {
        scope: { kind: 'maps-membership', project: key },
        attemptedAt: 0,
        observedAt: 0,
        provenance: {
          integration: 'github',
          connectionId: connectionIdSchema.parse('connection-home'),
          repositoryId: key.projectId,
          stage: 'map-list',
        },
        completeness: { kind: 'complete' },
        value: {
          members: maps
            .filter((map) => map.resource.kind !== 'proven-absent')
            .map((map) => map.ref),
        },
      },
    },
    maps,
    displayOrder: { open: maps.map((map) => map.ref), closed: [] },
    activeMap:
      maps[0] === undefined ? { kind: 'known-empty' } : { kind: 'known-current', ref: maps[0].ref },
  }
}

function renderProject(
  value: Project,
  path: string,
  store: RoadmapStore = makeRoadmapStore([value]),
): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(RoadmapProvider, { store }, createElement(App)),
    ),
  )
}

function retainedMap(map: MapResource): MapResource {
  const observation = resourceObservation(map.resource)
  if (observation === null)
    throw new Error('A retained fixture requires actual previously read map content')
  return {
    ...map,
    resource: {
      kind: 'retained-unavailable',
      lastSuccessful: observation,
      unavailable: {
        kind: 'source-failure',
        scope: observation.scope,
        attemptedAt: 1000,
        provenance: observation.provenance,
        failure: { kind: 'access-ambiguous', evidence: 'missing-alias' },
        cause: 'GitHub source is inaccessible; absence is not proven.',
      },
    },
  }
}

function absentTicket(ticket: TicketResource): TicketResource {
  const observation = resourceObservation(ticket.resource)
  if (observation === null)
    throw new Error('An absent trace fixture requires actual previously read ticket content')
  return {
    ...ticket,
    resource: {
      kind: 'proven-absent',
      absence: {
        scope: observation.scope,
        attemptedAt: 2000,
        observedAt: 2000,
        provenance: observation.provenance,
        proof: {
          kind: 'complete-membership',
          parent: { kind: 'tickets-membership', map: ticket.ref.map },
        },
      },
      trace: { kind: 'last-successful-trace', lastSuccessful: observation },
    },
  }
}

const uncertain = {
  kind: 'uncertain',
  reason: 'map-unavailable',
  cause: 'A map required for ordering is currently unavailable.',
} satisfies Project['activeMap']

describe('App pinned map resource interpretation', () => {
  it('retains pinned graph, raw prose, ticket source and independent child freshness during map failure', () => {
    const map = retainedMap(
      makeMap(
        [ticket('8', 'frontier', [], undefined, 0, 'task', { body: 'Independent ticket prose.' })],
        { raw: '# Retained raw map prose' },
      ),
    )
    const registered = { ...project([map]), activeMap: uncertain }
    const markup = renderProject(
      registered,
      ticketPath({ map: map.ref, ticketId: ticketIdSchema.parse('8') }),
    )

    expect(markup).toContain('Retained raw map prose')
    expect(markup).toContain('Independent ticket prose.')
    expect(markup).toContain('Currently unavailable')
    expect(markup).toContain('absence is not proven')
    expect(markup).toContain('1970-01-01T00:00:00.000Z')
    expect(markup).toContain('Current readable content')
    expect(markup).toContain('https://example.test/me/repo/8')
    expect(markup).toContain('No map is promoted to active')
    expect(mapGraph(map).nodes).toHaveLength(1)
  })

  it('keeps a proven absent map and ticket trace addressable as historical content', () => {
    const readable = makeMap(
      [ticket('8', 'frontier', [], undefined, 0, 'task', { body: 'Historical ticket prose.' })],
      { raw: 'Historical map prose.' },
    )
    const observation = resourceObservation(readable.resource)
    const knownTicket = readable.tickets[0]
    if (observation === null || knownTicket === undefined)
      throw new Error('Expected readable fixture')
    const absent: MapResource = {
      ...readable,
      resource: {
        kind: 'proven-absent',
        absence: {
          scope: observation.scope,
          attemptedAt: 2000,
          observedAt: 2000,
          provenance: observation.provenance,
          proof: {
            kind: 'complete-membership',
            parent: { kind: 'maps-membership', project: readable.ref.project },
          },
        },
        trace: { kind: 'last-successful-trace', lastSuccessful: observation },
      },
      tickets: [absentTicket(knownTicket)],
      ticketsMembership:
        readable.ticketsMembership.kind === 'current-complete'
          ? {
              kind: 'current-complete',
              observation: {
                ...readable.ticketsMembership.observation,
                attemptedAt: 2000,
                observedAt: 2000,
                value: { members: [] },
              },
            }
          : readable.ticketsMembership,
    }
    const registered: Project = {
      ...project([absent]),
      mapsMembership: { kind: 'never-observed', current: null },
      activeMap: uncertain,
      displayOrder: { open: [], closed: [] },
    }
    const markup = renderProject(registered, ticketPath(absent.tickets[0]?.ref ?? knownTicket.ref))

    expect(markup).toContain('Historical map prose.')
    expect(markup).toContain('Historical ticket prose.')
    expect(markup).toContain('Historical trace')
    expect(markup).toContain('Proven absent')
    expect(markup).toContain('Historical or unplaced maps')
    expect(markup).toContain('https://example.test/me/repo/8')
    expect(mapGraph(absent).nodes).toHaveLength(1)
  })

  it('does not select a readable sibling or unplaced newcomer while active order is uncertain', () => {
    const first = retainedMap(makeMap([], { raw: 'First retained prose.' }))
    const newcomer = makeMap(
      [],
      { raw: 'Newcomer prose.' },
      { ...first.ref, mapId: mapIdSchema.parse('new') },
      { title: 'New readable map', updatedAt: 3000 },
    )
    const registered = {
      ...project([first, newcomer]),
      activeMap: uncertain,
      displayOrder: { open: [first.ref], closed: [] },
    }
    const markup = renderProject(registered, projectPath(registered.ref))

    expect(markup).toContain('Current map ordering is uncertain')
    expect(markup).toContain('Historical or unplaced maps')
    expect(markup).toContain(mapPath(newcomer.ref))
    expect(markup).not.toContain('First retained prose.')
    expect(markup).not.toContain('Newcomer prose.')
  })

  it('never substitutes the current active map for a missing pinned identity', () => {
    const current = makeMap([], { raw: 'Do not substitute this map.' })
    const registered = project([current])
    const markup = renderProject(
      registered,
      mapPath({ ...current.ref, mapId: mapIdSchema.parse('missing') }),
    )

    expect(markup).toContain('No other map has been selected')
    expect(markup).not.toContain('Do not substitute this map.')
  })

  it('does not invent graph, source or prose for a never-read pinned map', () => {
    const key = {
      project: { integration: 'github', projectId: projectIdSchema.parse('project-home') },
      mapId: mapIdSchema.parse('never-read'),
    } as const
    const map: MapResource = {
      ref: key,
      resource: { kind: 'never-observed', scope: { kind: 'map', map: key }, current: null },
      tickets: [],
      frontier: [],
      ticketsMembership: { kind: 'never-observed', current: null },
    }
    const registered = { ...project([map]), activeMap: uncertain }
    const markup = renderProject(registered, mapPath(key))

    expect(markup).toContain('No source content is known')
    expect(markup).not.toContain('Map content')
    expect(markup).not.toContain('Map source</a>')
    expect(mapGraph(map).nodes).toHaveLength(0)
  })

  it('uses recovered same-identity content, source destinations and actual newer freshness', () => {
    const original = retainedMap(makeMap([ticket('8', 'frontier')], { raw: 'Old retained prose.' }))
    const recovered = makeMap(
      [
        ticket('8', 'frontier', [], undefined, 0, 'task', {
          source: { kind: 'issue', url: 'https://recovered.test/tickets/8' },
          body: 'Recovered ticket prose.',
        }),
      ],
      { raw: 'Recovered map prose.' },
      original.ref,
      { source: { kind: 'issue', url: 'https://recovered.test/maps/1' } },
    )
    if (recovered.resource.kind !== 'current-readable')
      throw new Error('Expected recovery observation')
    recovered.resource.observation.attemptedAt = 4000
    recovered.resource.observation.observedAt = 4000
    const path = ticketPath({ map: original.ref, ticketId: ticketIdSchema.parse('8') })
    const markup = renderProject(project([recovered]), path)

    expect(markup).toContain('Recovered map prose.')
    expect(markup).toContain('Recovered ticket prose.')
    expect(markup).toContain('https://recovered.test/maps/1')
    expect(markup).toContain('https://recovered.test/tickets/8')
    expect(markup).toContain('1970-01-01T00:00:04.000Z')
    expect(markup).not.toContain('Old retained prose.')
  })

  it('renders closed ticket block and claim facts with unknown type evidence in its URL-owned Modal', () => {
    const map = makeMap([
      ticket('closed', 'closed', [blocker('outside')], undefined, 0, 'untyped', {
        isBlocked: true,
        isClaimed: true,
        typeEvidence: { kind: 'unknown', labels: ['custom'] },
      }),
    ])
    const markup = renderProject(
      project([map]),
      ticketPath({
        map: map.ref,
        ticketId: ticketIdSchema.parse('closed'),
      }),
    )

    expect(markup).toContain('Decided')
    expect(markup).toMatch(/>Blocked<\/span>/)
    expect(markup).toMatch(/>Claimed<\/span>/)
    expect(markup).toContain('Unknown type: custom')
    expect(markup).toContain('https://example.test/me/repo/closed')
  })
})

describe('pinned resource content limits', () => {
  it('keeps incomplete readable raw Markdown and reports unknown counts without treating it as unreadable', () => {
    const map = makeMap(
      [],
      {
        raw: 'Readable incomplete raw content.',
        destination: '',
        missingSections: ['Destination'],
      },
      undefined,
      { progress: null },
    )
    if (map.resource.kind !== 'current-readable') throw new Error('Expected readable map')
    map.resource.observation.completeness = { kind: 'incomplete', reason: 'malformed' }
    const registered = {
      ...project([map]),
      activeMap: {
        kind: 'uncertain',
        reason: 'map-incomplete',
        cause: 'A map required for ordering is incomplete.',
      } satisfies Project['activeMap'],
    }
    const markup = renderProject(registered, mapPath(map.ref))

    expect(markup).toContain('Readable incomplete raw content.')
    expect(markup).toContain('Content is incomplete')
    expect(markup).toContain('Closed ticket count unknown')
    expect(markup).toContain('Destination')
    expect(markup).not.toContain('Currently unavailable')
  })

  it('does not fabricate source content for proven absence with no known trace', () => {
    const original = makeMap([])
    const observation = resourceObservation(original.resource)
    if (observation === null) throw new Error('Expected map scope fixture')
    const map: MapResource = {
      ...original,
      resource: {
        kind: 'proven-absent',
        absence: {
          scope: observation.scope,
          attemptedAt: 1000,
          observedAt: 1000,
          provenance: observation.provenance,
          proof: {
            kind: 'complete-membership',
            parent: { kind: 'maps-membership', project: original.ref.project },
          },
        },
        trace: { kind: 'no-known-trace' },
      },
    }
    const registered = {
      ...project([map]),
      activeMap: uncertain,
      displayOrder: { open: [], closed: [] },
    }
    const markup = renderProject(registered, mapPath(map.ref))

    expect(markup).toContain('No previously read content is known')
    expect(markup).not.toContain('Map content')
    expect(markup).not.toContain('Map source</a>')
    expect(mapGraph(map).nodes).toHaveLength(0)
  })
})

describe('URL-selected ticket Automation evidence', () => {
  it('shows no launch admission for a queued Session independently of completed Classification', () => {
    const map = makeMap([ticket('8', 'frontier')])
    const registered = project([map])
    const target = ticketRefSchema.parse({ map: map.ref, ticketId: '8' })
    const state = makeApplicationState([registered])
    state.automation.evidence = [
      {
        target,
        classification: {
          status: 'completed',
          admission: 'automatic',
          processResult: { status: 'exited', code: 0 },
          verdict: { value: 'afk', reason: 'Classification completed before Session admission.' },
        },
        wayfinder: { status: 'queued' },
      },
    ]
    const snapshot = makeRoadmapSnapshot(state)
    const store: RoadmapStore = {
      ...makeRoadmapStore([registered]),
      getSnapshot: () => snapshot,
    }

    const markup = renderProject(registered, ticketPath(target), store)
    const session = markup.match(/<h4>Wayfinder Session<\/h4>([\s\S]*?)<\/section>/)?.[1]

    expect(session).toContain('<dt>State</dt><dd><strong>Queued</strong>')
    expect(session).toContain('<dt>Admission</dt><dd><strong>No launch admission</strong>')
    expect(session).not.toContain('<strong>Automatic</strong>')
    expect(session).not.toContain('<strong>Override</strong>')
    expect(session).not.toContain('<dt>Process result</dt>')
    expect(session).not.toContain('<dt>Session report</dt>')
    expect(markup).toContain('<dt>Verdict</dt><dd><strong>AFK</strong>')
    expect(markup).toContain('<dt>Process result</dt><dd><strong>Exited 0</strong>')
  })

  it('keeps durable stage history without source content and honors server override denial', () => {
    const map = makeMap([])
    const registered = project([map])
    const state = makeApplicationState([registered])
    const target = ticketRefSchema.parse({
      map: map.ref,
      ticketId: ticketIdSchema.parse('historical-ticket'),
    })
    state.automation.evidence = [
      {
        target,
        classification: {
          status: 'completed',
          admission: 'automatic',
          processResult: { status: 'exited', code: 0 },
          verdict: { value: 'afk', reason: 'Recorded independently of current source content.' },
        },
        wayfinder: { status: 'queued' },
      },
    ]
    state.automation.overrides = [
      {
        target,
        classification: { status: 'ineligible', reason: 'Current source evidence is unavailable.' },
        wayfinder: { status: 'ineligible', reason: 'Current source evidence is unavailable.' },
      },
    ]
    const snapshot = makeRoadmapSnapshot(state)
    const store: RoadmapStore = {
      ...makeRoadmapStore([registered]),
      getSnapshot: () => snapshot,
    }

    const markup = renderProject(
      registered,
      ticketPath({ map: map.ref, ticketId: target.ticketId }),
      store,
    )

    expect(markup).toContain('No other ticket has been selected')
    expect(markup).toContain('Recorded Automation evidence')
    expect(markup).toContain('Recorded independently of current source content.')
    expect(markup).toContain('AFK')
    expect(markup).toContain('Queued')
    expect(markup).toContain('No source content known')
    expect(markup).toContain('Current source evidence is unavailable.')
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Run Classification<\/button>/)
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Start Wayfinder Session<\/button>/)
    expect(markup).not.toContain('Classification Run started.')
    expect(markup).not.toContain('Wayfinder Session started.')
  })

  it('keeps durable Automation evidence addressable when the selected Project and map are absent', () => {
    const state = makeApplicationState()
    const target = ticketRefSchema.parse({
      map: { project: { integration: 'local', projectId: 'absent-project' }, mapId: 'absent-map' },
      ticketId: 'absent-ticket',
    })
    state.automation.evidence = [
      {
        target,
        classification: {
          status: 'completed',
          admission: 'override',
          processResult: { status: 'exited', code: 0 },
          verdict: { value: 'afk', reason: 'Actual durable AFK verdict.' },
        },
        wayfinder: {
          status: 'outcome-unknown',
          admission: 'override',
          reason: 'Actual durable unknown outcome.',
          acknowledged: true,
        },
      },
    ]
    const snapshot = makeRoadmapSnapshot(state)
    const store: RoadmapStore = { ...makeRoadmapStore(), getSnapshot: () => snapshot }
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [ticketPath(target)] },
        createElement(RoadmapProvider, { store }, createElement(App)),
      ),
    )

    expect(markup).toContain('Recorded Automation evidence')
    expect(markup).toContain('Actual durable AFK verdict.')
    expect(markup).toContain('Actual durable unknown outcome.')
    const session = markup.match(/<h4>Wayfinder Session<\/h4>([\s\S]*?)<\/section>/)?.[1]
    expect(session).toContain('<dt>State</dt><dd><strong>Outcome unknown</strong>')
    expect(session).toContain('<dt>Acknowledgement</dt><dd><strong>Acknowledged</strong>')
    expect(session).toContain('<dt>Admission</dt><dd><strong>Override</strong>')
    expect(session).not.toContain('<strong>Finished</strong>')
    expect(session).not.toContain('<dt>Process result</dt>')
    expect(session).not.toContain('<dt>Session report</dt>')
    expect(markup).toContain('No other ticket has been selected')
    expect(markup).not.toContain('Map content')
  })

  it('keeps every missing scoped selection visible without claiming proven resource absence', () => {
    const otherMap = makeMap(
      [
        ticket('shared-ticket', 'frontier', [], undefined, 0, 'task', {
          body: 'Unrelated same-ID ticket prose.',
        }),
      ],
      { raw: 'Unrelated same-ID map prose.' },
      {
        project: { integration: 'github', projectId: 'project-home' },
        mapId: 'shared-map',
      },
    )
    const registered = project([otherMap])
    const target = ticketRefSchema.parse({
      map: {
        project: { integration: 'local', projectId: 'missing-project' },
        mapId: 'shared-map',
      },
      ticketId: 'shared-ticket',
    })
    const markup = renderProject(registered, ticketPath(target))

    expect(markup).toContain('missing-project')
    expect(markup).toContain('shared-map')
    expect(markup).toContain('shared-ticket')
    expect(markup).not.toContain('Unrelated same-ID map prose.')
    expect(markup).not.toContain('Unrelated same-ID ticket prose.')
    expect(markup).not.toContain('Proven absent')
    expect(markup).not.toContain('Map source</a>')
    expect(markup).not.toContain('Project source</a>')
  })
})

describe('trusted default history', () => {
  it('keeps the latest closed map as the default only when the server proves no current open map', () => {
    const map = makeMap([], { raw: 'Trusted closed history prose.' }, undefined, {
      status: 'closed',
    })
    const registered: Project = {
      ...project([map]),
      activeMap: { kind: 'known-empty' },
      displayOrder: { open: [], closed: [map.ref] },
    }

    expect(renderProject(registered, projectPath(registered.ref))).toContain(
      'Trusted closed history prose.',
    )
    expect(
      renderProject({ ...registered, activeMap: uncertain }, projectPath(registered.ref)),
    ).not.toContain('Trusted closed history prose.')
  })
})

describe('application lifecycle consumer admission', () => {
  it('does not render Project consumers from a starting application baseline', () => {
    const base = makeRoadmapStore()
    const accepted = base.getSnapshot()
    if (accepted.synchronization === 'not-ready') throw new Error('Expected fixture baseline')
    const snapshot = makeRoadmapSnapshot({
      phase: 'starting',
      serverEpoch: accepted.state.serverEpoch,
      stateSequence: accepted.state.stateSequence,
      capturedAt: accepted.state.capturedAt,
    })
    const store: RoadmapStore = { ...base, getSnapshot: () => snapshot }
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        createElement(RoadmapProvider, { store }, createElement(App)),
      ),
    )

    expect(markup).toContain('data-roadmap-readiness="waiting"')
    expect(markup).not.toContain('No Projects')
    expect(markup).not.toContain('Projects needing attention')
  })

  it('renders a valid known-empty ready baseline instead of waiting for source content', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        createElement(RoadmapProvider, { store: makeRoadmapStore() }, createElement(App)),
      ),
    )

    expect(markup).not.toContain('data-roadmap-readiness="waiting"')
    expect(markup).toContain('No Projects registered yet.')
  })

  it('renders actual terminal retained graph and prose without presenting live application readiness', () => {
    const map = makeMap(
      [ticket('8', 'frontier', [], undefined, 0, 'task', { body: 'Actual retained ticket.' })],
      { raw: 'Actual retained map.' },
    )
    const configured = project([map])
    const base = makeRoadmapStore([configured])
    const accepted = base.getSnapshot()
    if (accepted.synchronization === 'not-ready' || accepted.state.phase !== 'ready')
      throw new Error('Expected ready fixture')
    const terminal = {
      phase: 'stopped' as const,
      serverEpoch: accepted.state.serverEpoch,
      stateSequence: accepted.state.stateSequence,
      capturedAt: accepted.state.capturedAt,
      retained: accepted.state,
    }
    const snapshot = makeRoadmapSnapshot(terminal)
    const store: RoadmapStore = { ...base, getSnapshot: () => snapshot }
    const markup = renderProject(
      configured,
      ticketPath(map.tickets[0]?.ref ?? ticketRefSchema.parse({ map: map.ref, ticketId: '8' })),
      store,
    )

    expect(markup).toContain('data-roadmap-readiness="retained"')
    expect(markup).toContain('Actual retained map.')
    expect(markup).toContain('Actual retained ticket.')
    expect(markup).toContain('https://example.test/me/repo/8')
    expect(mapGraph(map).nodes).toHaveLength(1)
  })
})
