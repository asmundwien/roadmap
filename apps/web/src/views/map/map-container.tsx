import type { TicketId } from '@roadmap/contracts/identity'
import type { MapResource } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Controls, type FitViewOptions, type NodeTypes, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import classNames from 'classnames/bind'
import { useMemo } from 'react'
import { resourceObservation } from '@/views/shared/resource-results'
import { type MapGraph, type MapNode, mapGraph } from './graph'
import styles from './map.module.css'
import { TicketNode, TicketOpenContext } from './ticket-node'

const cx = classNames.bind(styles)
const nodeTypes = { ticket: TicketNode } satisfies NodeTypes
const fitViewOptions: FitViewOptions = { padding: 0.16, minZoom: 0.1, maxZoom: 1, duration: 0 }

export type MapContainerProps = {
  map: MapResource
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
  const graph = useMemo(() => projectGraph(map), [map, projectGraph])
  const graphKey = JSON.stringify([
    map.ref.project.integration,
    map.ref.project.projectId,
    map.ref.mapId,
  ])
  const content = resourceObservation(map.resource)?.value

  return (
    <div className={cx('mapContainer')}>
      {map.ticketsMembership.kind !== 'current-complete' && (
        <Alert variant="info">
          {map.ticketsMembership.kind === 'unavailable'
            ? map.ticketsMembership.unavailable.cause
            : 'Current ticket membership is incomplete or has never been established.'}{' '}
          Known ticket traces remain inspectable, but their presence does not prove current
          membership.
        </Alert>
      )}
      {content && content.body.missingSections.length > 0 && (
        <Alert variant="info">
          Map sections are missing: {content.body.missingSections.join(', ')}.
        </Alert>
      )}
      {content && content.warnings.length > 0 && (
        <Alert variant="info">
          <ul className={cx('warnings')}>
            {[...new Set(content.warnings)].map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}
      <p className={cx('graphHelp')}>
        {map.tickets.length} known ticket {map.tickets.length === 1 ? 'identity' : 'identities'},
        including{' '}
        {
          graph.nodes.filter(
            (node) => node.data.kind === 'ticket' && node.data.observation.value.state === 'closed',
          ).length
        }{' '}
        closed in readable or historical content. Arrows point from blockers to dependent tickets.
        Retained content is not Automation permission. Use the controls to zoom or fit the map.
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
              aria-label={`Ticket dependencies for ${content?.title ?? content?.displayId ?? map.ref.mapId}`}
            >
              <Controls showInteractive={false} fitViewOptions={fitViewOptions} />
            </ReactFlow>
          </TicketOpenContext.Provider>
        </div>
      )}
    </div>
  )
}
