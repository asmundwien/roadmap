import type { Blocker } from '@roadmap/contracts'
import { ReactFlow } from '@xyflow/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoadmapProvider } from '@/store/roadmap-provider'
import { type MapNode, mapGraph } from './graph'
import { blocker, makeMap, makeRoadmapStore, ticket } from './test-fixtures'
import { TicketModal } from './ticket-modal'
import { TicketNode } from './ticket-node'

function dependencyPairs(graph: ReturnType<typeof mapGraph>) {
  return graph.edges.map((edge) => {
    const source = graph.nodes.find((node) => node.id === edge.source)
    const target = graph.nodes.find((node) => node.id === edge.target)
    return {
      sourceKind: source?.data.kind,
      sourceReference: source?.data.kind === 'blocker' ? source.data.blocker.reference : undefined,
      sourceTicket:
        source?.data.kind === 'ticket' ? source.data.ticket.id : source?.data.blocker.ticketId,
      targetTicket: target?.data.kind === 'ticket' ? target.data.ticket.id : undefined,
    }
  })
}

describe('mapGraph', () => {
  it('does not merge an external repository locator with an admitted opaque project key', () => {
    const external = blocker('7', false, {
      kind: 'external',
      integration: 'github',
      nameWithOwner: 'outside/repository',
    })
    const map = {
      ...makeMap([ticket('7', 'closed'), ticket('8', 'frontier', [external])]),
      project: { integration: 'github', id: 'outside/repository' } as const,
    }

    const graph = mapGraph(map)
    const dependency = graph.edges[0]
    const source = graph.nodes.find((node) => node.id === dependency?.source)
    const internal = graph.nodes.find(
      (node) => node.data.kind === 'ticket' && node.data.ticket.id === '7',
    )

    expect(source?.data).toMatchObject({
      kind: 'blocker',
      scope: 'external',
      blocker: {
        reference: {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'outside/repository',
        },
        ticketId: '7',
        state: 'closed',
        url: 'https://example.test/outside/repository/7',
      },
    })
    expect(source?.id).not.toBe(internal?.id)
    expect(graph.nodes).toHaveLength(3)
    expect(map.tickets[1]?.state).toBe('frontier')
  })

  it('keeps same-ID blockers in other projects separate from an in-map ticket', () => {
    const otherIntegration = blocker('7', true, {
      kind: 'registered',
      project: { integration: 'local', id: 'project-home' },
    })
    const map = makeMap([
      ticket('7', 'frontier'),
      ticket('8', 'blocked', [
        blocker('7', true, {
          kind: 'registered',
          project: { integration: 'github', id: 'project-other' },
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
          project: { integration: 'github', id: 'project-other' },
        },
        sourceTicket: '7',
        targetTicket: '8',
      },
      {
        sourceKind: 'blocker',
        sourceReference: {
          kind: 'registered',
          project: { integration: 'local', id: 'project-home' },
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
          project: { integration: 'github', id: 'a' },
        }),
        blocker('c', true, {
          kind: 'registered',
          project: { integration: 'github', id: 'a:b' },
        }),
      ]),
    ])

    const graph = mapGraph(map)
    const sources = graph.edges.map((edge) => edge.source)

    expect(new Set(sources).size).toBe(2)
    expect(
      dependencyPairs(graph).map((pair) => [
        pair.sourceReference?.kind === 'registered' ? pair.sourceReference.project.id : undefined,
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
          project: { integration: 'github', id: 'project-home' },
        },
        ticketId: 'missing',
        state: 'unknown',
        url: 'https://example.test/me/repo/missing',
      },
    })
    expect(dependencyPairs(graph)).toEqual([
      {
        sourceKind: 'blocker',
        sourceReference: {
          kind: 'registered',
          project: { integration: 'github', id: 'project-home' },
        },
        sourceTicket: 'missing',
        targetTicket: 'dependent',
      },
    ])
  })

  it('keeps unresolved locator scopes separate from external and registered ticket scopes', () => {
    const unresolved: Blocker = {
      ...blocker('7', true, { kind: 'unresolved', locator: 'project-home' }),
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
        }),
        unresolved,
        blocker('7', true, { kind: 'unresolved', locator: 'other-locator' }),
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
        reference: { kind: 'unresolved', locator: 'project-home' },
        ticketId: '7',
        state: 'unknown',
        url: 'https://example.test/project-home/7',
      },
    })
    expect(sources[3]?.data).toMatchObject({
      kind: 'blocker',
      scope: 'unresolved',
      blocker: { reference: { kind: 'unresolved', locator: 'other-locator' }, state: 'open' },
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
      graph.nodes.flatMap((node) => (node.data.kind === 'ticket' ? [node.data.ticket.state] : [])),
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
        }),
        blocker('external', true, {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'other/repo',
        }),
      ]),
      ticket('b', 'blocked', [
        blocker('external', true, {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'other/repo',
        }),
      ]),
    ])

    const graph = mapGraph(map)

    expect(
      graph.nodes.flatMap((node) =>
        node.data.kind === 'blocker' ? [node.data.blocker.ticketId] : [],
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
  })

  it('does not change the live map snapshot while projecting and laying out dependencies', () => {
    const map = makeMap([
      ticket('a', 'blocked', [
        blocker('external', true, {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'other/repo',
        }),
      ]),
      ticket('b', 'closed'),
    ])
    const before = structuredClone(map)
    Object.freeze(map)
    Object.freeze(map.tickets)
    for (const item of map.tickets) {
      Object.freeze(item)
      Object.freeze(item.blockedBy)
      for (const dependency of item.blockedBy) Object.freeze(dependency)
    }

    mapGraph(map)

    expect(map).toEqual(before)
  })
})

describe('blocker source links', () => {
  it.each<Blocker['reference']>([
    { kind: 'external', integration: 'github', nameWithOwner: 'outside/repository' },
    { kind: 'unresolved', locator: 'outside/repository' },
    { kind: 'registered', project: { integration: 'github', id: 'other-project' } },
    { kind: 'registered', project: { integration: 'local', id: 'outside/repository' } },
  ])(
    'keeps a $kind blocker outside the current project as a source link in the Modal',
    (reference) => {
      const source: Blocker = {
        ...blocker('7', false, reference),
        title: 'Source-only blocker',
        url: 'https://outside.test/issues/7',
      }
      const map = {
        ...makeMap([
          { ...ticket('7', 'closed'), title: 'Internal seven' },
          ticket('8', 'frontier', [source]),
        ]),
        project: { integration: 'github', id: 'outside/repository' } as const,
      }

      const markup = renderToStaticMarkup(
        createElement(
          RoadmapProvider,
          { store: makeRoadmapStore() },
          createElement(TicketModal, {
            map,
            ticketId: '8',
            onClose: () => undefined,
            onOpenTicket: () => {
              throw new Error('Unexpected internal navigation')
            },
            onOpenMap: () => undefined,
          }),
        ),
      )

      expect(markup).toMatch(
        /<a[^>]*href="https:\/\/outside\.test\/issues\/7"[^>]*target="_blank"[^>]*>Source-only blocker/,
      )
      expect(markup).not.toContain('Internal seven')
      expect(markup).toContain('closed')
    },
  )

  it('offers internal ticket navigation for a registered blocker in the matching project', () => {
    const map = makeMap([
      { ...ticket('7', 'closed'), title: 'Internal seven' },
      ticket('8', 'frontier', [{ ...blocker('7', false), url: 'https://outside.test/issues/7' }]),
    ])

    const markup = renderToStaticMarkup(
      createElement(
        RoadmapProvider,
        { store: makeRoadmapStore() },
        createElement(TicketModal, {
          map,
          ticketId: '8',
          onClose: () => undefined,
          onOpenTicket: () => undefined,
          onOpenMap: () => undefined,
        }),
      ),
    )

    expect(markup).toMatch(/<button[^>]*>Internal seven<\/button>/)
    expect(markup).not.toContain('href="https://outside.test/issues/7"')
  })

  it.each<{ reference: Blocker['reference']; state: Blocker['state']; label: string }>([
    {
      reference: { kind: 'external', integration: 'github', nameWithOwner: 'me/repo' },
      state: 'closed',
      label: 'Closed blocker',
    },
    {
      reference: { kind: 'external', integration: 'github', nameWithOwner: 'me/repo' },
      state: 'open',
      label: 'Open blocker',
    },
    {
      reference: { kind: 'unresolved', locator: 'me/repo' },
      state: 'unknown',
      label: 'State unknown',
    },
  ])(
    'renders the $state $reference.kind blocker node with its source URL',
    ({ reference, state, label }) => {
      const source: Blocker = { ...blocker('7', true, reference), state }
      const graph = mapGraph(makeMap([ticket('7', 'closed'), ticket('8', 'blocked', [source])]))
      const node = graph.nodes.find((item) => item.data.kind === 'blocker')
      if (!node) throw new Error('Expected a source blocker node')

      const markup = renderToStaticMarkup(
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
      )

      expect(markup).toMatch(
        /<a[^>]*href="https:\/\/example\.test\/me\/repo\/7"[^>]*target="_blank"[^>]*>Open source/,
      )
      expect(markup).toContain(label)
      expect(markup).not.toContain('Open ticket')
    },
  )
})
