import type { Blocker } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { blocker, makeMap, ticket } from '@/views/map/test-fixtures'
import { mapGraph } from './graph'

function dependencyPairs(graph: ReturnType<typeof mapGraph>) {
  return graph.edges.map((edge) => {
    const source = graph.nodes.find((node) => node.id === edge.source)
    const target = graph.nodes.find((node) => node.id === edge.target)
    return {
      sourceKind: source?.data.kind,
      sourceProject: source?.data.kind === 'blocker' ? source.data.blocker.project : undefined,
      sourceTicket:
        source?.data.kind === 'ticket' ? source.data.ticket.id : source?.data.blocker.ticketId,
      targetTicket: target?.data.kind === 'ticket' ? target.data.ticket.id : undefined,
    }
  })
}

describe('mapGraph', () => {
  it('keeps same-ID blockers in other projects separate from an in-map ticket', () => {
    const otherIntegration: Blocker = {
      ...blocker('7'),
      project: { integration: 'local', id: 'me/repo' },
    }
    const map = makeMap([
      ticket('7', 'frontier'),
      ticket('8', 'blocked', [blocker('7', true, 'other/repo'), otherIntegration]),
    ])

    const graph = mapGraph(map)

    expect(dependencyPairs(graph)).toEqual([
      {
        sourceKind: 'blocker',
        sourceProject: { integration: 'github', id: 'other/repo' },
        sourceTicket: '7',
        targetTicket: '8',
      },
      {
        sourceKind: 'blocker',
        sourceProject: { integration: 'local', id: 'me/repo' },
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
      ticket('dependent', 'blocked', [blocker('b:c', true, 'a'), blocker('c', true, 'a:b')]),
    ])

    const graph = mapGraph(map)
    const sources = graph.edges.map((edge) => edge.source)

    expect(new Set(sources).size).toBe(2)
    expect(
      dependencyPairs(graph).map((pair) => [pair.sourceProject?.id, pair.sourceTicket]),
    ).toEqual([
      ['a', 'b:c'],
      ['a:b', 'c'],
    ])
  })

  it('preserves unresolved blocker identity, unknown state, and source without inventing a ticket', () => {
    const unknown: Blocker = { ...blocker('missing'), state: 'unknown' }
    const map = makeMap([ticket('dependent', 'blocked', [unknown])])

    const graph = mapGraph(map)
    const missing = graph.nodes.find((node) => node.data.kind === 'blocker')

    expect(missing?.data).toMatchObject({
      kind: 'blocker',
      scope: 'missing',
      blocker: {
        project: { integration: 'github', id: 'me/repo' },
        ticketId: 'missing',
        state: 'unknown',
        url: 'https://example.test/me/repo/missing',
      },
    })
    expect(dependencyPairs(graph)).toEqual([
      {
        sourceKind: 'blocker',
        sourceProject: { integration: 'github', id: 'me/repo' },
        sourceTicket: 'missing',
        targetTicket: 'dependent',
      },
    ])
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
        sourceProject: undefined,
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
        blocker('external', true, 'other/repo'),
        blocker('external', true, 'other/repo'),
      ]),
      ticket('b', 'blocked', [blocker('external', true, 'other/repo')]),
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
    const known = blocker('external', true, 'other/repo')
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
      ticket('a', 'blocked', [blocker('external', true, 'other/repo')]),
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
