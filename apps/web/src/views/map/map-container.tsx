import type { TicketId } from '@roadmap/contracts/identity'
import type { MapResource } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Controls, type FitViewOptions, type NodeTypes, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import classNames from 'classnames/bind'
import { useMemo } from 'react'
import type { MapResult } from '@/resources/results'
import { type MapGraph, type MapNode, mapGraph } from './graph'
import styles from './map.module.css'
import { TicketNode, TicketOpenContext, TicketPresentationContext } from './ticket-node'

const cx = classNames.bind(styles)
const nodeTypes = { ticket: TicketNode } satisfies NodeTypes
const fitViewOptions: FitViewOptions = { padding: 0.16, minZoom: 0.1, maxZoom: 1, duration: 0 }

export type MapContainerProps = {
  map: Extract<MapResult, { kind: 'known' }>
  onOpenTicket: (id: TicketId) => void
}

export function MapContainer({ map, onOpenTicket }: MapContainerProps) {
  const projectGraph = useMemo(() => {
    let previous: MapGraph | undefined
    return (snapshot: MapResource) => {
      const next = mapGraph(snapshot, previous)
      previous = next
      return next
    }
  }, [])
  // Opening a modal or replacing its callback does not project or lay out the map again.
  const graph = useMemo(() => projectGraph(map.resource), [map.resource, projectGraph])
  const graphKey = JSON.stringify([
    map.ref.project.integration,
    map.ref.project.projectId,
    map.ref.mapId,
  ])
  const content = map.content

  return (
    <div className={cx('mapContainer')}>
      {map.membershipMessage && <Alert variant="info">{map.membershipMessage}</Alert>}
      {map.graphWarnings.map((warning) => (
        <Alert key={warning} variant="info">
          {warning}
        </Alert>
      ))}
      <p className={cx('graphHelp')}>
        {map.knownTicketCount} known ticket {map.knownTicketCount === 1 ? 'identity' : 'identities'}
        , including {map.knownClosedTicketCount} closed in readable or historical content. Arrows
        point from blockers to dependent tickets. Retained content is not Automation permission. Use
        the controls to zoom or fit the map.
      </p>
      {graph.nodes.length === 0 ? (
        <Surface>
          <SurfaceDescription>No ticket records are available for this map.</SurfaceDescription>
        </Surface>
      ) : (
        <div className={cx('graph')}>
          <TicketOpenContext.Provider value={onOpenTicket}>
            <TicketPresentationContext.Provider value={map}>
              <ReactFlow<MapNode>
                key={graphKey}
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                nodesFocusable={false}
                edgesFocusable={false}
                edgesReconnectable={false}
                elementsSelectable={false}
                connectOnClick={false}
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                noDragClassName={cx('actions')}
                noPanClassName={cx('actions')}
                minZoom={0.1}
                maxZoom={2}
                fitView
                fitViewOptions={fitViewOptions}
                colorMode="system"
                aria-label={`Ticket dependencies for ${content?.title ?? content?.displayId ?? map.ref.mapId}`}
              >
                <Controls showInteractive={false} fitViewOptions={fitViewOptions} />
              </ReactFlow>
            </TicketPresentationContext.Provider>
          </TicketOpenContext.Provider>
        </div>
      )}
    </div>
  )
}
