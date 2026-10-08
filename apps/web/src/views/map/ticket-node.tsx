import { type Ticket, ticketTypeOf } from '@roadmap/contracts'
import { Badge } from '@roadmap/ui/badge'
import { Button } from '@roadmap/ui/button'
import { Link } from '@roadmap/ui/link'
import { Surface } from '@roadmap/ui/surface'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import classNames from 'classnames/bind'
import { createContext, memo, useContext } from 'react'
import { stripInlineMarkdown } from '@/views/shared/gist'
import { TicketMark } from '@/views/shared/ticket-mark'
import { TICKET_STATE_META, TICKET_TYPE_META } from '@/views/shared/ticket-presentation'
import type { MapNode } from './graph'
import styles from './map.module.css'

const cx = classNames.bind(styles)

export const TicketOpenContext = createContext<((id: string) => void) | null>(null)

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

type BlockerCardProps = {
  data: Extract<MapNode['data'], { kind: 'blocker' }>
}

function BlockerCard({ data }: BlockerCardProps) {
  const { blocker, scope } = data
  const identity = blocker.displayId ?? blocker.ticketId
  const title = stripInlineMarkdown(blocker.title ?? '').trim() || 'Blocker title unavailable'
  const { reference } = blocker
  const project =
    reference.kind === 'registered'
      ? `${reference.project.integration}: ${reference.project.id}`
      : reference.kind === 'external'
        ? `${reference.integration}: ${reference.nameWithOwner}`
        : reference.locator
  return (
    <Surface
      className={cx('ticketNode', 'blockerNode')}
      aria-label={`${project}, ${identity}: ${title}`}
    >
      <NodeHandles />
      <div className={cx('identity')} title={identity}>
        <span className={cx('ticketId')}>{identity}</span>
        <Badge variant="warning">
          {scope === 'external'
            ? 'External blocker'
            : scope === 'unresolved'
              ? 'Unresolved blocker'
              : 'Missing from map'}
        </Badge>
      </div>
      <p className={cx('ticketTitle')} title={title}>
        {title}
      </p>
      <div className={cx('badges')}>
        <Badge
          variant={
            blocker.state === 'unknown'
              ? 'warning'
              : blocker.state === 'closed'
                ? 'muted'
                : 'danger'
          }
        >
          {blocker.state === 'unknown'
            ? 'State unknown'
            : blocker.state === 'closed'
              ? 'Closed blocker'
              : 'Open blocker'}
        </Badge>
      </div>
      <p className={cx('metadata')} title={project}>
        {project}
      </p>
      <p className={cx('incomplete')}>
        {scope === 'unresolved'
          ? 'Project scope could not be resolved.'
          : scope === 'external'
            ? 'Ticket belongs to another project.'
            : 'Ticket details are absent from this map.'}
      </p>
      <div className={cx('actions', 'nodrag', 'nopan')}>
        {blocker.url ? (
          <Link href={blocker.url} external>
            Open source
          </Link>
        ) : (
          <span className={cx('metadata')}>Source link unavailable</span>
        )}
      </div>
    </Surface>
  )
}

type TicketCardProps = {
  ticket: Ticket
}

function TicketCard({ ticket }: TicketCardProps) {
  const onOpenTicket = useContext(TicketOpenContext)
  const identity = ticket.displayId ?? ticket.id
  const title = stripInlineMarkdown(ticket.title ?? '').trim() || 'Untitled ticket'
  const type = ticketTypeOf(ticket.typeEvidence)
  const stateMeta = TICKET_STATE_META[ticket.state]
  const assignees = ticket.assignees.map((assignee) => assignee.name).join(', ') || 'Unassigned'
  const unknownBlocker = ticket.blockedBy.some((blocker) => blocker.state === 'unknown')
  const typeLabel =
    ticket.typeEvidence.kind === 'recognized' ? type : `Type ${ticket.typeEvidence.kind}`

  return (
    <Surface className={cx('ticketNode')} aria-label={`${identity}: ${title}`}>
      <NodeHandles />
      <div className={cx('identity')}>
        <TicketMark size="large" state={ticket.state} type={type} />
        <span className={cx('ticketId')} title={identity}>
          {identity}
        </span>
      </div>
      <p className={cx('ticketTitle')} title={title}>
        {title}
      </p>
      <div className={cx('badges')}>
        <Badge variant={stateMeta.variant}>{stateMeta.word}</Badge>
        <Badge variant={TICKET_TYPE_META[type].accent}>{typeLabel}</Badge>
        {ticket.isBlocked && ticket.state !== 'blocked' && <Badge variant="danger">blocked</Badge>}
        {ticket.isClaimed && ticket.state !== 'claimed' && <Badge variant="info">claimed</Badge>}
      </div>
      <p className={cx('metadata')} title={assignees}>
        {assignees}
      </p>
      <p className={cx('incomplete')}>
        {!ticket.blockersComplete && <>Blocker list incomplete. </>}
        {unknownBlocker && <>Unknown blocker state. </>}
        {ticket.warnings.length > 0 && (
          <span title={ticket.warnings.join('\n')}>
            {ticket.warnings.length} {ticket.warnings.length === 1 ? 'warning' : 'warnings'}.
          </span>
        )}
      </p>
      <div className={cx('actions', 'nodrag', 'nopan')}>
        <Button
          size="small"
          onClick={() => onOpenTicket?.(ticket.id)}
          disabled={!onOpenTicket}
          aria-label={`Open ${identity}: ${title}`}
        >
          Open ticket
        </Button>
      </div>
    </Surface>
  )
}

export const TicketNode = memo(function TicketNode({ data }: TicketNodeProps) {
  return data.kind === 'blocker' ? <BlockerCard data={data} /> : <TicketCard ticket={data.ticket} />
})
