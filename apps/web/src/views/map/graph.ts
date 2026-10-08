import { type EdgeLabel, Graph, type GraphLabel, layout, type NodeLabel } from '@dagrejs/dagre'
import type { Blocker, ProjectKey, Ticket, WayfinderMap } from '@roadmap/contracts'
import { type Edge, MarkerType, type Node, Position } from '@xyflow/react'

type MapNodeData =
  | { kind: 'ticket'; ticket: Ticket }
  | { kind: 'blocker'; blocker: Blocker; scope: 'external' | 'missing' | 'unresolved' }

export type MapNode = Node<MapNodeData, 'ticket'>

export type MapGraph = {
  nodes: MapNode[]
  edges: Edge[]
}

const TICKET_NODE_WIDTH = 340
const TICKET_NODE_HEIGHT = 324

function scopedTicketId(project: ProjectKey, ticketId: string): string {
  return JSON.stringify(['registered', project.integration, project.id, ticketId])
}

export function blockerNodeId(blocker: Blocker): string {
  const { reference, ticketId } = blocker
  switch (reference.kind) {
    case 'registered':
      return scopedTicketId(reference.project, ticketId)
    case 'external':
      return JSON.stringify(['external', reference.integration, reference.nameWithOwner, ticketId])
    case 'unresolved':
      return JSON.stringify(['unresolved', reference.locator, ticketId])
    default: {
      const exhaustive: never = reference
      return exhaustive
    }
  }
}

function sameProject(left: ProjectKey, right: ProjectKey): boolean {
  return left.integration === right.integration && left.id === right.id
}

function ticketNode(id: string, data: MapNodeData): MapNode {
  return {
    id,
    type: 'ticket',
    data,
    position: { x: 0, y: 0 },
    width: TICKET_NODE_WIDTH,
    height: TICKET_NODE_HEIGHT,
    style: { width: TICKET_NODE_WIDTH, height: TICKET_NODE_HEIGHT },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: false,
    connectable: false,
    selectable: false,
  }
}

function addBlockerNode(
  nodes: Map<string, MapNode>,
  project: ProjectKey,
  blocker: Blocker,
): string {
  const source = blockerNodeId(blocker)
  const existing = nodes.get(source)
  if (!existing) {
    nodes.set(
      source,
      ticketNode(source, {
        kind: 'blocker',
        blocker: { ...blocker },
        scope:
          blocker.reference.kind === 'unresolved'
            ? 'unresolved'
            : blocker.reference.kind === 'registered' &&
                sameProject(project, blocker.reference.project)
              ? 'missing'
              : 'external',
      }),
    )
  } else if (existing.data.kind === 'blocker') {
    const previous = existing.data.blocker
    // Contradictory observations must not turn unknown evidence into a known state.
    existing.data = {
      ...existing.data,
      blocker: {
        ...previous,
        displayId: previous.displayId ?? blocker.displayId,
        title: previous.title ?? blocker.title,
        url: previous.url ?? blocker.url,
        state: previous.state === blocker.state ? previous.state : 'unknown',
      },
    }
  }
  return source
}

function addBlockerEdge(
  edges: Map<string, Edge>,
  source: string,
  target: string,
  blocker: Blocker,
  ticket: Ticket,
): void {
  const edgeId = JSON.stringify([source, target])
  if (edges.has(edgeId)) return
  edges.set(edgeId, {
    id: edgeId,
    ...(source === target
      ? {
          sourceHandle: 'self-source',
          targetHandle: 'self-target',
          label: 'Self-dependency',
        }
      : {}),
    source,
    target,
    type: 'default',
    markerEnd: { type: MarkerType.ArrowClosed },
    ariaLabel: `${blocker.displayId ?? blocker.ticketId} blocks ${ticket.displayId ?? ticket.id}`,
    selectable: false,
    reconnectable: false,
  })
}

function hasSameTopology(
  previous: MapGraph,
  nodes: Map<string, MapNode>,
  edges: Map<string, Edge>,
): boolean {
  return (
    previous.nodes.length === nodes.size &&
    previous.edges.length === edges.size &&
    previous.nodes.every((node) => nodes.has(node.id)) &&
    previous.edges.every((edge) => edges.has(edge.id))
  )
}

function populateDependencies(
  map: WayfinderMap,
  nodes: Map<string, MapNode>,
  edges: Map<string, Edge>,
): void {
  for (const ticket of map.tickets) {
    const target = scopedTicketId(map.project, ticket.id)
    for (const blocker of ticket.blockedBy) {
      const source = addBlockerNode(nodes, map.project, blocker)
      addBlockerEdge(edges, source, target, blocker, ticket)
    }
  }
}

/** Project only real blocked-by relationships; never infer a target from an unscoped ticket ID. */
export function mapGraph(map: WayfinderMap, previous?: MapGraph): MapGraph {
  const nodes = new Map<string, MapNode>()
  const edges = new Map<string, Edge>()

  for (const ticket of map.tickets) {
    const id = scopedTicketId(map.project, ticket.id)
    nodes.set(id, ticketNode(id, { kind: 'ticket', ticket }))
  }
  populateDependencies(map, nodes, edges)

  if (previous && hasSameTopology(previous, nodes, edges)) {
    // Fixed card dimensions mean content changes do not require another Dagre pass.
    for (const previousNode of previous.nodes) {
      const node = nodes.get(previousNode.id)
      if (node) node.position = previousNode.position
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] }
  }

  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>()
  graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 100, marginx: 24, marginy: 24 })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const node of nodes.values()) {
    graph.setNode(node.id, { width: TICKET_NODE_WIDTH, height: TICKET_NODE_HEIGHT })
  }
  for (const edge of edges.values()) graph.setEdge(edge.source, edge.target)
  layout(graph)

  for (const node of nodes.values()) {
    const position = graph.node(node.id)
    if (!position || position.x === undefined || position.y === undefined) {
      throw new Error(`Dependency layout did not position ${node.id}`)
    }
    node.position = {
      x: position.x - TICKET_NODE_WIDTH / 2,
      y: position.y - TICKET_NODE_HEIGHT / 2,
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}
