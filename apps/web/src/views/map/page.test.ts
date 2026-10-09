import type { MapResource, RegisteredProject, TicketResource } from '@roadmap/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App } from '@/App'
import { mapPath, projectPath, ticketPath } from '@/router'
import { RoadmapProvider } from '@/store/roadmap-provider'
import type { RoadmapStore } from '@/store/roadmap-store'
import { resourceObservation } from '@/views/shared/resource-results'
import { mapGraph } from './graph'
import { makeMap, makeRoadmapStore, ticket } from './test-fixtures'

function project(maps: MapResource[]): RegisteredProject {
  const key = { integration: 'github', id: 'project-home' } as const
  return {
    key,
    connectionId: 'connection-home',
    locator: { integration: 'github', repositoryId: key.id, nameWithOwner: 'me/repo' },
    workspace: { path: '/workspace' },
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
          connectionId: 'connection-home',
          repositoryId: key.id,
          stage: 'repository',
        },
        completeness: { kind: 'complete' },
        value: {
          name: 'Source project',
          source: {
            integration: 'github',
            repositoryId: key.id,
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
          connectionId: 'connection-home',
          repositoryId: key.id,
          stage: 'map-list',
        },
        completeness: { kind: 'complete' },
        value: { members: maps.map((map) => map.key) },
      },
    },
    maps,
    displayOrder: { openMapIds: maps.map((map) => map.key.mapId), closedMapIds: [] },
    activeMap:
      maps[0] === undefined
        ? { kind: 'known-empty' }
        : { kind: 'known-current', mapId: maps[0].key.mapId },
  }
}

function renderProject(
  value: RegisteredProject,
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
          parent: { kind: 'tickets-membership', map: ticket.key.map },
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
} satisfies RegisteredProject['activeMap']

describe('App pinned map resource interpretation', () => {
  it('retains pinned graph, raw prose, ticket source and independent child freshness during map failure', () => {
    const map = retainedMap(
      makeMap(
        [ticket('8', 'frontier', [], undefined, 0, 'task', { body: 'Independent ticket prose.' })],
        { raw: '# Retained raw map prose' },
      ),
    )
    const registered = { ...project([map]), activeMap: uncertain }
    const markup = renderProject(registered, ticketPath({ map: map.key, ticketId: '8' }))

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
            parent: { kind: 'maps-membership', project: readable.key.project },
          },
        },
        trace: { kind: 'last-successful-trace', lastSuccessful: observation },
      },
      tickets: [absentTicket(knownTicket)],
    }
    const registered: RegisteredProject = {
      ...project([absent]),
      mapsMembership: { kind: 'never-observed', current: null },
      activeMap: uncertain,
      displayOrder: { openMapIds: [], closedMapIds: [] },
    }
    const markup = renderProject(registered, ticketPath(absent.tickets[0]?.key ?? knownTicket.key))

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
      { ...first.key, mapId: 'new' },
      { title: 'New readable map', updatedAt: 3000 },
    )
    const registered = {
      ...project([first, newcomer]),
      activeMap: uncertain,
      displayOrder: { openMapIds: [first.key.mapId], closedMapIds: [] },
    }
    const markup = renderProject(registered, projectPath(registered.key))

    expect(markup).toContain('Current map ordering is uncertain')
    expect(markup).toContain('Historical or unplaced maps')
    expect(markup).toContain(mapPath(newcomer.key))
    expect(markup).not.toContain('First retained prose.')
    expect(markup).not.toContain('Newcomer prose.')
  })

  it('never substitutes the current active map for a missing pinned identity', () => {
    const current = makeMap([], { raw: 'Do not substitute this map.' })
    const registered = project([current])
    const markup = renderProject(registered, mapPath({ ...current.key, mapId: 'missing' }))

    expect(markup).toContain('No other map has been selected')
    expect(markup).not.toContain('Do not substitute this map.')
  })

  it('does not invent graph, source or prose for a never-read pinned map', () => {
    const key = {
      project: { integration: 'github', id: 'project-home' },
      mapId: 'never-read',
    } as const
    const map: MapResource = {
      key,
      resource: { kind: 'never-observed', scope: { kind: 'map', map: key }, current: null },
      tickets: [],
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
      original.key,
      { source: { kind: 'issue', url: 'https://recovered.test/maps/1' } },
    )
    if (recovered.resource.kind !== 'current-readable')
      throw new Error('Expected recovery observation')
    recovered.resource.observation.attemptedAt = 4000
    recovered.resource.observation.observedAt = 4000
    const path = ticketPath({ map: original.key, ticketId: '8' })
    const markup = renderProject(project([recovered]), path)

    expect(markup).toContain('Recovered map prose.')
    expect(markup).toContain('Recovered ticket prose.')
    expect(markup).toContain('https://recovered.test/maps/1')
    expect(markup).toContain('https://recovered.test/tickets/8')
    expect(markup).toContain('1970-01-01T00:00:04.000Z')
    expect(markup).not.toContain('Old retained prose.')
  })
})

describe('pinned resource content limits', () => {
  it('keeps incomplete readable raw Markdown and reports unknown counts without treating it as unreadable', () => {
    const map = makeMap(
      [],
      { raw: 'Readable incomplete raw content.', missingSections: ['Destination'] },
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
      } satisfies RegisteredProject['activeMap'],
    }
    const markup = renderProject(registered, mapPath(map.key))

    expect(markup).toContain('Readable incomplete raw content.')
    expect(markup).toContain('Content is incomplete')
    expect(markup).toContain('Closed ticket count unknown')
    expect(markup).toContain('Map sections are missing')
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
            parent: { kind: 'maps-membership', project: original.key.project },
          },
        },
        trace: { kind: 'no-known-trace' },
      },
    }
    const registered = {
      ...project([map]),
      activeMap: uncertain,
      displayOrder: { openMapIds: [], closedMapIds: [] },
    }
    const markup = renderProject(registered, mapPath(map.key))

    expect(markup).toContain('No previously read content is known')
    expect(markup).not.toContain('Map content')
    expect(markup).not.toContain('Map source</a>')
    expect(mapGraph(map).nodes).toHaveLength(0)
  })
})

describe('URL-selected ticket Automation evidence', () => {
  it('keeps durable stage history without source content and honors server override denial', () => {
    const map = makeMap([])
    const registered = project([map])
    const store = makeRoadmapStore([registered])
    const snapshot = store.getSnapshot()
    if (snapshot.synchronization === 'not-ready')
      throw new Error('Expected authoritative fixture state')
    const target = { project: map.key.project, mapId: map.key.mapId, ticketId: 'historical-ticket' }
    snapshot.state.automation.evidence = [
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
    snapshot.state.automation.overrides = [
      {
        target,
        classification: { status: 'ineligible', reason: 'Current source evidence is unavailable.' },
        wayfinder: { status: 'ineligible', reason: 'Current source evidence is unavailable.' },
      },
    ]

    const markup = renderProject(
      registered,
      ticketPath({ map: map.key, ticketId: target.ticketId }),
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
  })
})

describe('trusted default history', () => {
  it('keeps the latest closed map as the default only when the server proves no current open map', () => {
    const map = makeMap([], { raw: 'Trusted closed history prose.' }, undefined, {
      status: 'closed',
    })
    const registered: RegisteredProject = {
      ...project([map]),
      activeMap: { kind: 'known-empty' },
      displayOrder: { openMapIds: [], closedMapIds: [map.key.mapId] },
    }

    expect(renderProject(registered, projectPath(registered.key))).toContain(
      'Trusted closed history prose.',
    )
    expect(
      renderProject({ ...registered, activeMap: uncertain }, projectPath(registered.key)),
    ).not.toContain('Trusted closed history prose.')
  })
})
