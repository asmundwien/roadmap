import type { TicketId } from '@roadmap/contracts/identity'
import { Badge } from '@roadmap/ui/badge'
import { Button } from '@roadmap/ui/button'
import { Link } from '@roadmap/ui/link'
import { Surface } from '@roadmap/ui/surface'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import classNames from 'classnames/bind'
import { createContext, memo, useContext } from 'react'
import { Link as NavigationLink } from '@/navigation'
import { type MapResult, presentBlockerResource, presentTicketResource } from '@/resources/results'
import { ticketPath } from '@/router'
import { TicketMark } from '@/views/shared/ticket-mark'
import type { MapNode } from './graph'
import styles from './map.module.css'

const cx = classNames.bind(styles)
export const TicketOpenContext = createContext<((id: TicketId) => void) | null>(null)
export const TicketPresentationContext = createContext<Extract<
  MapResult,
  { kind: 'known' }
> | null>(null)
export type TicketNodeProps = NodeProps<MapNode>

function NodeHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={cx('handle')}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={cx('handle')}
      />
      <Handle
        id="self-source"
        type="source"
        position={Position.Top}
        isConnectable={false}
        className={cx('handle', 'selfSource')}
      />
      <Handle
        id="self-target"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={cx('handle', 'selfTarget')}
      />
    </>
  )
}

type BlockerCardProps = { data: Extract<MapNode['data'], { kind: 'blocker' }> }

function BlockerCard({ data }: BlockerCardProps) {
  const map = useContext(TicketPresentationContext)
  const key = JSON.stringify(data.blocker.reference)
  const blocker = presentBlockerResource(data.blocker, map?.ref, {
    scope: data.scope,
    target: map?.blockers.find((item) => item.key === key),
  })
  return (
    <Surface
      className={cx('ticketNode', 'blockerNode')}
      aria-label={blocker.scope + ', ' + blocker.displayId + ': ' + blocker.title}
    >
      <NodeHandles />
      <div className={cx('identity')}>
        <span className={cx('ticketId')}>{blocker.displayId}</span>
        <Badge variant="warning">{blocker.scopeLabel}</Badge>
      </div>
      <p className={cx('ticketTitle')}>{blocker.title}</p>
      <div className={cx('badges')}>
        <Badge variant="warning">{blocker.graphStateLabel}</Badge>
        {blocker.tracker && (
          <>
            <Badge variant={blocker.tracker.variant}>{blocker.tracker.label}</Badge>
            <Badge variant={blocker.tracker.typeAccent}>{blocker.tracker.typeLabel}</Badge>
            {blocker.tracker.blockedLabel && (
              <Badge variant="danger">{blocker.tracker.blockedLabel}</Badge>
            )}
            {blocker.tracker.claimedLabel && (
              <Badge variant="info">{blocker.tracker.claimedLabel}</Badge>
            )}
          </>
        )}
      </div>
      <p className={cx('metadata')}>{blocker.scope}</p>
      {blocker.graphMessage && <p className={cx('incomplete')}>{blocker.graphMessage}</p>}
      {blocker.availability && (
        <p className={cx('metadata')} title={blocker.availability.message}>
          {blocker.availability.label}
        </p>
      )}
      <div className={cx('actions', 'nodrag', 'nopan')}>
        {blocker.target && (
          <NavigationLink href={ticketPath(blocker.target)}>Open ticket</NavigationLink>
        )}
        {blocker.source.kind === 'link' ? (
          <Link href={blocker.source.href} external>
            Open source
          </Link>
        ) : (
          <span className={cx('metadata')}>Source link unavailable</span>
        )}
      </div>
    </Surface>
  )
}

type TicketCardProps = { data: Extract<MapNode['data'], { kind: 'ticket' }> }

function TicketCard({ data }: TicketCardProps) {
  const onOpenTicket = useContext(TicketOpenContext)
  const map = useContext(TicketPresentationContext)
  const scoped = map?.tickets.find((item) => item.ref.ticketId === data.ticket.ref.ticketId)
  const result = scoped?.kind === 'known' ? scoped : presentTicketResource(data.ticket)
  const tracker = result.tracker
  const content = data.observation.value
  const assignees = content.assignees.map((assignee) => assignee.name).join(', ') || 'Unassigned'
  return (
    <Surface className={cx('ticketNode')} aria-label={result.displayId + ': ' + result.title}>
      <NodeHandles />
      <div className={cx('identity')}>
        {tracker && <TicketMark size="large" state={tracker.state} type={tracker.type} />}
        <span className={cx('ticketId')}>{result.displayId}</span>
      </div>
      <p className={cx('ticketTitle')}>{result.title}</p>
      {tracker && (
        <div className={cx('badges')}>
          <Badge variant={tracker.variant}>{tracker.label}</Badge>
          <Badge variant={tracker.typeAccent}>{tracker.typeLabel}</Badge>
          {tracker.blockedLabel && <Badge variant="danger">{tracker.blockedLabel}</Badge>}
          {tracker.claimedLabel && <Badge variant="info">{tracker.claimedLabel}</Badge>}
        </div>
      )}
      <p className={cx('metadata')} title={assignees}>
        {assignees}
      </p>
      <p className={cx('incomplete')}>
        {!content.blockersComplete && <>Blocker list incomplete. </>}
        {result.unknownBlocker && <>Unknown blocker state. </>}
        {content.warnings.length > 0 && (
          <span title={content.warnings.join('\n')}>
            {content.warnings.length} {content.warnings.length === 1 ? 'warning' : 'warnings'}.
          </span>
        )}
      </p>
      <p className={cx('metadata')} title={result.availability?.message}>
        {result.availability?.label}
      </p>
      <div className={cx('actions', 'nodrag', 'nopan')}>
        <Button
          size="small"
          onClick={() => onOpenTicket?.(data.ticket.ref.ticketId)}
          disabled={!onOpenTicket}
          aria-label={'Open ' + result.displayId + ': ' + result.title}
        >
          Open ticket
        </Button>
      </div>
    </Surface>
  )
}

export const TicketNode = memo(function TicketNode({ data }: TicketNodeProps) {
  return data.kind === 'blocker' ? <BlockerCard data={data} /> : <TicketCard data={data} />
})
