import {
  mapIdSchema,
  projectIdSchema,
  ticketIdSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import type { Blocker, TicketResourceResult } from '@roadmap/contracts/state'
import { ReactFlow } from '@xyflow/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { resolveSelection, resourceObservation } from '@/resources/results'
import { RoadmapProvider } from '@/store/roadmap-provider'
import { type MapNode, mapGraph } from './graph'
import {
  blocker,
  makeApplicationState,
  makeMap,
  makeProject,
  makeRoadmapSnapshot,
  makeRoadmapStore,
  ticket,
} from './test-fixtures'
import { TicketModal } from './ticket-modal'
import { TicketNode, TicketPresentationContext } from './ticket-node'

function dependencyPairs(graph: ReturnType<typeof mapGraph>) {
  return graph.edges.map((edge) => {
    const source = graph.nodes.find((node) => node.id === edge.source)
    const target = graph.nodes.find((node) => node.id === edge.target)
    return {
      sourceKind: source?.data.kind,
      sourceReference: source?.data.kind === 'blocker' ? source.data.blocker.reference : undefined,
      sourceTicket:
        source?.data.kind === 'ticket'
          ? source.data.ticket.ref.ticketId
          : source?.data.kind === 'blocker'
            ? source.data.blocker.reference.kind === 'registered'
              ? source.data.blocker.reference.ticket.ticketId
              : source.data.blocker.reference.ticketId
            : undefined,
      targetTicket: target?.data.kind === 'ticket' ? target.data.ticket.ref.ticketId : undefined,
    }
  })
}

describe('mapGraph', () => {
  it('does not merge an external repository locator with an admitted opaque project key', () => {
    const external = blocker('7', false, {
      kind: 'external',
      integration: 'github',
      nameWithOwner: 'outside/repository',
      ticketId: ticketIdSchema.parse(String('7')),
    })
    const map = makeMap(
      [ticket('7', 'closed'), ticket('8', 'frontier', [external])],
      {},
      {
        project: { integration: 'github', projectId: projectIdSchema.parse('outside/repository') },
        mapId: mapIdSchema.parse('1'),
      },
    )

    const graph = mapGraph(map)
    const dependency = graph.edges[0]
    const source = graph.nodes.find((node) => node.id === dependency?.source)
    const internal = graph.nodes.find(
      (node) => node.data.kind === 'ticket' && node.data.ticket.ref.ticketId === '7',
    )

    expect(source?.data).toMatchObject({
      kind: 'blocker',
      scope: 'external',
      blocker: {
        reference: {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'outside/repository',
          ticketId: ticketIdSchema.parse('7'),
        },
        state: 'closed',
        url: 'https://example.test/outside/repository/7',
      },
    })
    expect(source?.id).not.toBe(internal?.id)
    expect(graph.nodes).toHaveLength(3)
    expect(map.tickets[1] && resourceObservation(map.tickets[1].resource)?.value.state).toBe(
      'frontier',
    )
  })

  it('keeps same-ID blockers in other projects separate from an in-map ticket', () => {
    const otherIntegration = blocker('7', true, {
      kind: 'registered',
      ticket: ticketRefSchema.parse({
        map: {
          project: { integration: 'local', projectId: projectIdSchema.parse('project-home') },
          mapId: mapIdSchema.parse('1'),
        },
        ticketId: String('7'),
      }),
    })
    const map = makeMap([
      ticket('7', 'frontier'),
      ticket('8', 'blocked', [
        blocker('7', true, {
          kind: 'registered',
          ticket: ticketRefSchema.parse({
            map: {
              project: { integration: 'github', projectId: projectIdSchema.parse('project-other') },
              mapId: mapIdSchema.parse('1'),
            },
            ticketId: String('7'),
          }),
        }),
        otherIntegration,
      ]),
    ])

    const graph = mapGraph(map)

    expect(dependencyPairs(graph)).toEqual([
      {
        sourceKind: 'blocker',
        sourceReference: {
          kind: 'registered',
          ticket: ticketRefSchema.parse({
            map: {
              project: { integration: 'github', projectId: projectIdSchema.parse('project-other') },
              mapId: mapIdSchema.parse('1'),
            },
            ticketId: ticketIdSchema.parse('7'),
          }),
        },
        sourceTicket: '7',
        targetTicket: '8',
      },
      {
        sourceKind: 'blocker',
        sourceReference: {
          kind: 'registered',
          ticket: ticketRefSchema.parse({
            map: {
              project: { integration: 'local', projectId: projectIdSchema.parse('project-home') },
              mapId: mapIdSchema.parse('1'),
            },
            ticketId: ticketIdSchema.parse('7'),
          }),
        },
        sourceTicket: '7',
        targetTicket: '8',
      },
    ])
    expect(
      graph.nodes.flatMap((node) => (node.data.kind === 'blocker' ? [node.data.scope] : [])),
    ).toEqual(['external', 'external'])
  })

  it('does not collide project IDs and ticket IDs that contain separators', () => {
    const map = makeMap([
      ticket('dependent', 'blocked', [
        blocker('b:c', true, {
          kind: 'registered',
          ticket: ticketRefSchema.parse({
            map: {
              project: { integration: 'github', projectId: projectIdSchema.parse('a') },
              mapId: mapIdSchema.parse('1'),
            },
            ticketId: String('b:c'),
          }),
        }),
        blocker('c', true, {
          kind: 'registered',
          ticket: ticketRefSchema.parse({
            map: {
              project: { integration: 'github', projectId: projectIdSchema.parse('a:b') },
              mapId: mapIdSchema.parse('1'),
            },
            ticketId: String('c'),
          }),
        }),
      ]),
    ])

    const graph = mapGraph(map)
    const sources = graph.edges.map((edge) => edge.source)

    expect(new Set(sources).size).toBe(2)
    expect(
      dependencyPairs(graph).map((pair) => [
        pair.sourceReference?.kind === 'registered'
          ? pair.sourceReference.ticket.map.project.projectId
          : undefined,
        pair.sourceTicket,
      ]),
    ).toEqual([
      ['a', 'b:c'],
      ['a:b', 'c'],
    ])
  })

  it('preserves a missing registered blocker with unknown state and its source link', () => {
    const unknown: Blocker = { ...blocker('missing'), state: 'unknown' }
    const map = makeMap([ticket('dependent', 'blocked', [unknown])])

    const graph = mapGraph(map)
    const missing = graph.nodes.find((node) => node.data.kind === 'blocker')

    expect(missing?.data).toMatchObject({
      kind: 'blocker',
      scope: 'missing',
      blocker: {
        reference: {
          kind: 'registered',
          ticket: ticketRefSchema.parse({
            map: {
              project: { integration: 'github', projectId: projectIdSchema.parse('project-home') },
              mapId: mapIdSchema.parse('1'),
            },
            ticketId: ticketIdSchema.parse('missing'),
          }),
        },
        state: 'unknown',
        url: 'https://example.test/me/repo/missing',
      },
    })
    expect(dependencyPairs(graph)).toEqual([
      {
        sourceKind: 'blocker',
        sourceReference: {
          kind: 'registered',
          ticket: ticketRefSchema.parse({
            map: {
              project: { integration: 'github', projectId: projectIdSchema.parse('project-home') },
              mapId: mapIdSchema.parse('1'),
            },
            ticketId: ticketIdSchema.parse('missing'),
          }),
        },
        sourceTicket: 'missing',
        targetTicket: 'dependent',
      },
    ])
  })

  it('keeps unresolved locator scopes separate from external and registered ticket scopes', () => {
    const unresolved: Blocker = {
      ...blocker('7', true, {
        kind: 'unresolved',
        locator: 'project-home',
        ticketId: ticketIdSchema.parse(String('7')),
      }),
      state: 'unknown',
    }
    const map = makeMap([
      ticket('7', 'closed'),
      ticket('dependent', 'blocked', [
        blocker('7', false),
        blocker('7', false, {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'project-home',
          ticketId: ticketIdSchema.parse(String('7')),
        }),
        unresolved,
        blocker('7', true, {
          kind: 'unresolved',
          locator: 'other-locator',
          ticketId: ticketIdSchema.parse(String('7')),
        }),
      ]),
    ])

    const graph = mapGraph(map)
    const sources = graph.edges.map((edge) => graph.nodes.find((node) => node.id === edge.source))

    expect(new Set(graph.edges.map((edge) => edge.source)).size).toBe(4)
    expect(sources.map((source) => source?.data.kind)).toEqual([
      'ticket',
      'blocker',
      'blocker',
      'blocker',
    ])
    expect(sources[2]?.data).toMatchObject({
      kind: 'blocker',
      scope: 'unresolved',
      blocker: {
        reference: {
          kind: 'unresolved',
          locator: 'project-home',
          ticketId: ticketIdSchema.parse('7'),
        },
        state: 'unknown',
        url: 'https://example.test/project-home/7',
      },
    })
    expect(sources[3]?.data).toMatchObject({
      kind: 'blocker',
      scope: 'unresolved',
      blocker: {
        reference: {
          kind: 'unresolved',
          locator: 'other-locator',
          ticketId: ticketIdSchema.parse('7'),
        },
        state: 'open',
      },
    })
  })

  it('preserves closed tickets and directs edges from the blocker to its dependent', () => {
    const map = makeMap([
      ticket('finished', 'closed'),
      ticket('dependent', 'frontier', [blocker('finished', false)]),
      ticket('unrelated', 'closed'),
    ])

    const graph = mapGraph(map)

    expect(
      graph.nodes.flatMap((node) =>
        node.data.kind === 'ticket' ? [node.data.observation.value.state] : [],
      ),
    ).toEqual(['closed', 'frontier', 'closed'])
    expect(dependencyPairs(graph)).toEqual([
      {
        sourceKind: 'ticket',
        sourceReference: undefined,
        sourceTicket: 'finished',
        targetTicket: 'dependent',
      },
    ])
  })

  it('retains cycles and self-dependencies with finite layout positions', () => {
    const map = makeMap([
      ticket('a', 'blocked', [blocker('b'), blocker('a')]),
      ticket('b', 'blocked', [blocker('a')]),
    ])

    const graph = mapGraph(map)

    expect(dependencyPairs(graph).map((pair) => [pair.sourceTicket, pair.targetTicket])).toEqual([
      ['b', 'a'],
      ['a', 'a'],
      ['a', 'b'],
    ])
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true)
      expect(Number.isFinite(node.position.y)).toBe(true)
    }
  })

  it('deduplicates the same scoped blocker and edge while preserving all dependent relationships', () => {
    const map = makeMap([
      ticket('a', 'blocked', [
        blocker('external', true, {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'other/repo',
          ticketId: ticketIdSchema.parse(String('external')),
        }),
        blocker('external', true, {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'other/repo',
          ticketId: ticketIdSchema.parse(String('external')),
        }),
      ]),
      ticket('b', 'blocked', [
        blocker('external', true, {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'other/repo',
          ticketId: ticketIdSchema.parse(String('external')),
        }),
      ]),
    ])

    const graph = mapGraph(map)

    expect(
      graph.nodes.flatMap((node) =>
        node.data.kind === 'blocker'
          ? [
              node.data.blocker.reference.kind === 'registered'
                ? node.data.blocker.reference.ticket.ticketId
                : node.data.blocker.reference.ticketId,
            ]
          : [],
      ),
    ).toEqual(['external'])
    expect(dependencyPairs(graph).map((pair) => [pair.sourceTicket, pair.targetTicket])).toEqual([
      ['external', 'a'],
      ['external', 'b'],
    ])
  })

  it('keeps unknown evidence explicit when duplicate blocker observations disagree', () => {
    const known = blocker('external', true, {
      kind: 'external',
      integration: 'github',
      nameWithOwner: 'other/repo',
      ticketId: ticketIdSchema.parse(String('external')),
    })
    const unknown: Blocker = { ...known, title: undefined, url: undefined, state: 'unknown' }
    const map = makeMap([ticket('a', 'blocked', [known]), ticket('b', 'blocked', [unknown])])

    const graph = mapGraph(map)
    const external = graph.nodes.find((node) => node.data.kind === 'blocker')

    expect(external?.data).toMatchObject({
      kind: 'blocker',
      blocker: {
        state: 'unknown',
        title: 'Ticket external',
        url: 'https://example.test/other/repo/external',
      },
    })
    if (!external) throw new Error('Expected merged blocker node')
    const project = makeProject([map])
    project.activeMap = {
      kind: 'uncertain',
      reason: 'map-incomplete',
      cause: 'A map required for ordering is incomplete.',
    }
    const selection = resolveSelection(makeApplicationState([project]), {
      project: map.ref.project,
      map: map.ref,
      ticket: null,
    })
    if (selection.map?.kind !== 'known') throw new Error('Expected known map presentation')
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(
          TicketPresentationContext.Provider,
          { value: selection.map },
          createElement(ReactFlow<MapNode>, {
            nodes: [external],
            edges: [],
            nodeTypes: { ticket: TicketNode },
            width: 800,
            height: 400,
          }),
        ),
      ),
    )
    expect(markup).toContain('Ticket external')
    expect(markup).toContain('href="https://example.test/other/repo/external"')
    expect(markup).toContain('State unknown')
  })

  it('does not change the live map snapshot while projecting and laying out dependencies', () => {
    const map = makeMap([
      ticket('a', 'blocked', [
        blocker('external', true, {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'other/repo',
          ticketId: ticketIdSchema.parse(String('external')),
        }),
      ]),
      ticket('b', 'closed'),
    ])
    const before = structuredClone(map)
    Object.freeze(map)
    Object.freeze(map.tickets)
    for (const item of map.tickets) {
      Object.freeze(item)
      const content = resourceObservation(item.resource)?.value
      if (content) {
        Object.freeze(content.blockedBy)
        for (const dependency of content.blockedBy) Object.freeze(dependency)
      }
    }

    mapGraph(map)

    expect(map).toEqual(before)
  })
})

describe('blocker source links', () => {
  it.each<Blocker['reference']>([
    {
      kind: 'external',
      integration: 'github',
      nameWithOwner: 'outside/repository',
      ticketId: ticketIdSchema.parse('7'),
    },
    { kind: 'unresolved', locator: 'outside/repository', ticketId: ticketIdSchema.parse('7') },
    {
      kind: 'registered',
      ticket: ticketRefSchema.parse({
        map: {
          project: { integration: 'github', projectId: projectIdSchema.parse('other-project') },
          mapId: mapIdSchema.parse('1'),
        },
        ticketId: ticketIdSchema.parse('7'),
      }),
    },
    {
      kind: 'registered',
      ticket: ticketRefSchema.parse({
        map: {
          project: { integration: 'local', projectId: projectIdSchema.parse('outside/repository') },
          mapId: mapIdSchema.parse('1'),
        },
        ticketId: ticketIdSchema.parse('7'),
      }),
    },
  ])(
    'keeps a $kind blocker outside the current project as a source link in the Modal',
    (reference) => {
      const source: Blocker = {
        ...blocker('7', false, reference),
        title: 'Source-only blocker',
        url: 'https://outside.test/issues/7',
      }
      const map = makeMap(
        [
          ticket('7', 'closed', [], undefined, 0, 'task', { title: 'Internal seven' }),
          ticket('8', 'frontier', [source]),
        ],
        {},
        {
          project: {
            integration: 'github',
            projectId: projectIdSchema.parse('outside/repository'),
          },
          mapId: mapIdSchema.parse('1'),
        },
      )

      const markup = renderToStaticMarkup(
        createElement(
          MemoryRouter,
          {},
          createElement(
            RoadmapProvider,
            {
              store: makeRoadmapStore(
                [],
                makeRoadmapSnapshot(makeApplicationState([makeProject([map])])),
              ),
            },
            createElement(TicketModal, {
              selected: { map: map.ref, ticketId: ticketIdSchema.parse('8') },
              onClose: () => undefined,
              onOpenTicket: () => {
                throw new Error('Unexpected internal navigation')
              },
              onOpenMap: () => undefined,
            }),
          ),
        ),
      )

      expect(markup).toMatch(
        /<a[^>]*href="https:\/\/outside\.test\/issues\/7"[^>]*target="_blank"[^>]*>Source-only blocker/,
      )
      expect(markup).not.toContain('Internal seven')
    },
  )

  it('offers internal ticket navigation for a registered blocker in the matching project', () => {
    const map = makeMap([
      ticket('7', 'closed', [], undefined, 0, 'task', { title: 'Internal seven' }),
      ticket('8', 'frontier', [{ ...blocker('7', false), url: 'https://outside.test/issues/7' }]),
    ])

    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {},
        createElement(
          RoadmapProvider,
          {
            store: makeRoadmapStore(
              [],
              makeRoadmapSnapshot(makeApplicationState([makeProject([map])])),
            ),
          },
          createElement(TicketModal, {
            selected: { map: map.ref, ticketId: ticketIdSchema.parse('8') },
            onClose: () => undefined,
            onOpenTicket: () => undefined,
            onOpenMap: () => undefined,
          }),
        ),
      ),
    )

    expect(markup).toMatch(/<button[^>]*>Internal seven<\/button>/)
    expect(markup).not.toContain('href="https://outside.test/issues/7"')
  })

  it.each<{ reference: Blocker['reference']; state: Blocker['state']; label: string }>([
    {
      reference: {
        kind: 'external',
        integration: 'github',
        nameWithOwner: 'me/repo',
        ticketId: ticketIdSchema.parse('7'),
      },
      state: 'closed',
      label: 'Closed blocker',
    },
    {
      reference: {
        kind: 'external',
        integration: 'github',
        nameWithOwner: 'me/repo',
        ticketId: ticketIdSchema.parse('7'),
      },
      state: 'open',
      label: 'Open blocker',
    },
    {
      reference: { kind: 'unresolved', locator: 'me/repo', ticketId: ticketIdSchema.parse('7') },
      state: 'unknown',
      label: 'State unknown',
    },
    {
      reference: {
        kind: 'registered',
        ticket: ticketRefSchema.parse({
          map: {
            project: { integration: 'github', projectId: projectIdSchema.parse('project-home') },
            mapId: mapIdSchema.parse('other-map'),
          },
          ticketId: '7',
        }),
      },
      state: 'unknown',
      label: 'State unknown',
    },
  ])(
    'renders the $state $reference.kind blocker node with its source URL',
    ({ reference, state, label }) => {
      const source: Blocker = { ...blocker('7', true, reference), state }
      const graph = mapGraph(
        makeMap([
          ticket('7', 'closed'),
          ticket('8', state === 'closed' ? 'frontier' : 'blocked', [source]),
        ]),
      )
      const node = graph.nodes.find((item) => item.data.kind === 'blocker')
      if (!node) throw new Error('Expected a source blocker node')

      const markup = renderToStaticMarkup(
        createElement(
          MemoryRouter,
          {},
          createElement(ReactFlow<MapNode>, {
            nodes: [node],
            edges: [],
            nodeTypes: { ticket: TicketNode },
            width: 800,
            height: 400,
            nodesDraggable: false,
            nodesConnectable: false,
            elementsSelectable: false,
          }),
        ),
      )

      expect(markup).toMatch(
        /<a[^>]*href="https:\/\/example\.test\/me\/repo\/7"[^>]*target="_blank"[^>]*>Open source/,
      )
      expect(markup).toContain(label)
      if (reference.kind === 'registered') {
        expect(markup).toContain('Registered outside map')
        expect(markup).not.toContain('Missing from map')
        expect(markup).toContain('Open ticket')
      } else {
        expect(markup).not.toContain('Open ticket')
      }
    },
  )
})

describe('ticket node evidence', () => {
  it.each<{
    evidence: Extract<
      TicketResourceResult,
      { kind: 'current-readable' }
    >['observation']['value']['typeEvidence']
    label: string
  }>([
    { evidence: { kind: 'missing', labels: [] }, label: 'Type missing' },
    { evidence: { kind: 'unknown', labels: ['custom'] }, label: 'Unknown type: custom' },
    {
      evidence: { kind: 'conflicting', labels: ['research', 'task'] },
      label: 'Conflicting types: research, task',
    },
  ])('keeps closed block and claim facts visible with $label', ({ evidence, label }) => {
    const map = makeMap([
      ticket('closed', 'closed', [blocker('outside')], undefined, 0, 'untyped', {
        isBlocked: true,
        isClaimed: true,
        typeEvidence: evidence,
      }),
    ])
    const node = mapGraph(map).nodes.find((item) => item.data.kind === 'ticket')
    if (!node) throw new Error('Expected ticket node')
    const markup = renderToStaticMarkup(
      createElement(ReactFlow<MapNode>, {
        nodes: [node],
        edges: [],
        nodeTypes: { ticket: TicketNode },
        width: 800,
        height: 400,
      }),
    )
    expect(markup).toContain('Decided')
    expect(markup).toMatch(/>Blocked<\/span>/)
    expect(markup).toMatch(/>Claimed<\/span>/)
    expect(markup).toContain(label)
  })
})

describe('map resource graph identities', () => {
  it('keeps equal ticket IDs under different map keys separate', () => {
    const first = makeMap([ticket('same', 'frontier')])
    const second = makeMap(
      [ticket('same', 'frontier')],
      {},
      { ...first.ref, mapId: mapIdSchema.parse('other-map') },
    )

    expect(mapGraph(first).nodes[0]?.id).not.toBe(mapGraph(second).nodes[0]?.id)
  })
})
