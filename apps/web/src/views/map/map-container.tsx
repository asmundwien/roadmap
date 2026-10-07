import type { WayfinderMap } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Controls, type FitViewOptions, type NodeTypes, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import classNames from 'classnames/bind'
import { useMemo } from 'react'
import { type MapGraph, type MapNode, mapGraph } from './graph'
import styles from './map.module.css'
import { TicketNode, TicketOpenContext } from './ticket-node'

const cx = classNames.bind(styles)
const nodeTypes = { ticket: TicketNode } satisfies NodeTypes
const fitViewOptions: FitViewOptions = { padding: 0.16, minZoom: 0.1, maxZoom: 1, duration: 0 }

export type MapContainerProps = {
  map: WayfinderMap
  onOpenTicket: (id: string) => void
}

export function MapContainer({ map, onOpenTicket }: MapContainerProps) {
  const projectGraph = useMemo(() => {
    let previous: MapGraph | undefined
    return (snapshot: WayfinderMap) => {
      const next = mapGraph(snapshot, previous)
      previous = next
      return next
    }
  }, [])
  // Opening a modal or replacing its callback does not project or lay out the map again.
  const graph = useMemo(() => projectGraph(map), [map, projectGraph])
  const graphKey = JSON.stringify([map.project.integration, map.project.id, map.id])

  return (
    <div className={cx('mapContainer')}>
      {!map.ticketsComplete && (
        <Alert variant="info">
          Ticket records are incomplete. Some work may be absent from this map.
        </Alert>
      )}
      {map.body.missingSections.length > 0 && (
        <Alert variant="info">
          Map sections are missing: {map.body.missingSections.join(', ')}.
        </Alert>
      )}
      {map.warnings.length > 0 && (
        <Alert variant="info">
          <ul className={cx('warnings')}>
            {[...new Set(map.warnings)].map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}
      <p className={cx('graphHelp')}>
        {map.tickets.length} {map.tickets.length === 1 ? 'ticket' : 'tickets'} on this map,
        including {map.tickets.filter((ticket) => ticket.state === 'closed').length} closed. Arrows
        point from blockers to dependent tickets. Use the controls to zoom or fit the map.
      </p>
      {graph.nodes.length === 0 ? (
        <Surface>
          <SurfaceDescription>No ticket records are available for this map.</SurfaceDescription>
        </Surface>
      ) : (
        <div className={cx('graph')}>
          <TicketOpenContext.Provider value={onOpenTicket}>
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
              aria-label={`Ticket dependencies for ${map.title ?? map.displayId ?? map.id}`}
            >
              <Controls showInteractive={false} fitViewOptions={fitViewOptions} />
            </ReactFlow>
          </TicketOpenContext.Provider>
        </div>
      )}
    </div>
  )
}
