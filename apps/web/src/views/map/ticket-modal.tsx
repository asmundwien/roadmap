import type { TicketId, TicketRef } from '@roadmap/contracts/identity'
import type { AutomationOverrideStage, MapResource } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { Button } from '@roadmap/ui/button'
import { Link } from '@roadmap/ui/link'
import { Modal } from '@roadmap/ui/modal'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { useState } from 'react'
import { Link as NavigationLink } from '@/navigation'
import {
  type AutomationControlResult,
  type BlockerResult,
  resolveSelection,
  type TicketResult,
} from '@/resources/results'
import { ticketPath } from '@/router'
import { type RoadmapViewState, useRoadmap } from '@/store/roadmap-provider'
import { TicketMark } from '@/views/shared/ticket-mark'
import { Prose } from './prose'
import styles from './ticket-modal.module.css'

const cx = classNames.bind(styles)

export type TicketModalProps = {
  selected: TicketRef | null
  onClose: () => void
  onOpenTicket: (id: TicketId) => void
  onOpenMap: () => void
}

export function TicketModal({ selected, onClose, onOpenTicket, onOpenMap }: TicketModalProps) {
  const view = useRoadmap((read) => ({
    result:
      selected === null
        ? null
        : resolveSelection(read, {
            project: selected.map.project,
            map: selected.map,
            ticket: selected,
          }),
    configurationVersion: read.configurationVersion,
    command: read.command,
    execute: read.execute,
  }))
  const ticket = view.result?.ticket
  const map = view.result?.map
  return (
    <Modal
      open={selected !== null}
      onClose={onClose}
      title={ticket?.title ?? 'Ticket'}
      className={cx('modal')}
    >
      {ticket && (
        <>
          <Alert variant="info">
            {ticket.kind === 'known' ? 'Ticket source. ' : ''}
            {ticket.message}
          </Alert>
          <TicketContent
            key={ticket.key}
            ticket={ticket}
            map={map?.kind === 'known' ? map.resource : null}
            roadmap={view}
            onOpenTicket={onOpenTicket}
            onOpenMap={onOpenMap}
          />
        </>
      )}
    </Modal>
  )
}

type AutomationViewState = Pick<RoadmapViewState, 'configurationVersion' | 'command' | 'execute'>
type TicketContentProps = {
  ticket: TicketResult
  map: MapResource | null
  roadmap: AutomationViewState
  onOpenTicket: (id: TicketId) => void
  onOpenMap: () => void
}

function TicketContent({ ticket, map, roadmap, onOpenTicket, onOpenMap }: TicketContentProps) {
  const content = ticket.content
  const tracker = ticket.tracker
  const proseProps =
    map === null
      ? null
      : {
          map,
          sourcePath: ticket.source.kind === 'file' ? ticket.source.path : undefined,
          onOpenTicket,
          onOpenMap,
        }
  return (
    <div className={cx('content')}>
      {content && tracker && (
        <>
          <div className={cx('identity')}>
            <span>{ticket.displayId}</span>
            <Badge variant={tracker.typeAccent}>{tracker.typeLabel}</Badge>
            <Badge variant={tracker.variant}>
              <TicketMark state={tracker.state} type={tracker.type} size="small" />
              {tracker.label}
            </Badge>
            {tracker.blockedLabel && <Badge variant="danger">{tracker.blockedLabel}</Badge>}
            {tracker.claimedLabel && <Badge variant="info">{tracker.claimedLabel}</Badge>}
          </div>
          {ticket.source.kind === 'link' && (
            <Link href={ticket.source.href} external>
              View item in source
            </Link>
          )}
          {ticket.source.kind === 'file' && (
            <p className={cx('supporting')}>{ticket.source.path}</p>
          )}
          {(content.assignees.length > 0 || content.closedAt !== undefined) && (
            <dl className={cx('metadata')}>
              {content.assignees.length > 0 && (
                <div>
                  <dt>Assignees</dt>
                  <dd>
                    {content.assignees.map((assignee, index) => (
                      <span key={assignee.url ?? assignee.name}>
                        {index > 0 && ', '}
                        {assignee.url ? (
                          <Link href={assignee.url} external>
                            {assignee.name}
                          </Link>
                        ) : (
                          assignee.name
                        )}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              {content.closedAt !== undefined && (
                <div>
                  <dt>Closed</dt>
                  <dd>
                    {new Date(content.closedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {proseProps && content.body.trim() !== '' && (
            <Prose {...proseProps} markdown={content.body} />
          )}
          {proseProps && ticket.decisionGist !== null && (
            <Surface variant="subtle">
              <SurfaceTitle>The decision</SurfaceTitle>
              <Prose {...proseProps} markdown={ticket.decisionGist} />
            </Surface>
          )}
          {ticket.blockers.length > 0 && (
            <Surface variant="subtle">
              <SurfaceTitle>Blocked by</SurfaceTitle>
              <ul className={cx('blockers')}>
                {ticket.blockers.map((blocker) => (
                  <li key={blocker.key}>
                    <BlockerItem blocker={blocker} onOpenTicket={onOpenTicket} />
                  </li>
                ))}
              </ul>
            </Surface>
          )}
          {!content.blockersComplete && (
            <Alert variant="info">Some blockers could not be resolved.</Alert>
          )}
          {content.warnings.map((warning) => (
            <Alert key={warning} variant="info">
              {warning}
            </Alert>
          ))}
        </>
      )}
      {ticket.membershipMessage && <Alert variant="info">{ticket.membershipMessage}</Alert>}
      <AutomationSection roadmap={roadmap} ticket={ticket} />
    </div>
  )
}

type BlockerItemProps = { blocker: BlockerResult; onOpenTicket: (id: TicketId) => void }

function BlockerItem({ blocker, onOpenTicket }: BlockerItemProps) {
  return (
    <div className={cx('blocker')}>
      {blocker.target ? (
        blocker.local ? (
          <Button
            size="small"
            onClick={() => {
              if (blocker.target) onOpenTicket(blocker.target.ticketId)
            }}
          >
            {blocker.title}
          </Button>
        ) : (
          <NavigationLink href={ticketPath(blocker.target)}>{blocker.title}</NavigationLink>
        )
      ) : blocker.source.kind === 'link' ? (
        <Link href={blocker.source.href} external>
          {blocker.title}
        </Link>
      ) : (
        <span>{blocker.title}</span>
      )}
      {blocker.tracker && (
        <>
          <Badge variant={blocker.tracker.variant}>
            <TicketMark state={blocker.tracker.state} type={blocker.tracker.type} size="small" />
            {blocker.tracker.label}
          </Badge>
          <Badge variant={blocker.tracker.typeAccent}>{blocker.tracker.typeLabel}</Badge>
          {blocker.tracker.blockedLabel && (
            <Badge variant="danger">{blocker.tracker.blockedLabel}</Badge>
          )}
          {blocker.tracker.claimedLabel && (
            <Badge variant="info">{blocker.tracker.claimedLabel}</Badge>
          )}
        </>
      )}
      <span className={cx('supporting')}>
        {blocker.scope} · {blocker.displayId} · {blocker.stateLabel}
      </span>
      {blocker.source.kind === 'absent' && (
        <span className={cx('supporting')}>No source link is available.</span>
      )}
      {blocker.source.kind === 'file' && (
        <span className={cx('supporting')}>{blocker.source.path}</span>
      )}
      {blocker.message && <span className={cx('supporting')}>{blocker.message}</span>}
      {blocker.target && !blocker.local && blocker.source.kind === 'link' && (
        <Link href={blocker.source.href} external>
          {blocker.title}
        </Link>
      )}
    </div>
  )
}

type AutomationSectionProps = { roadmap: AutomationViewState; ticket: TicketResult }

function AutomationSection({ roadmap, ticket: result }: AutomationSectionProps) {
  const ticket = result.ref
  const automation = result.automation
  const evidence = automation.evidence
  const [feedback, setFeedback] = useState<{ kind: 'notice' | 'error'; text: string } | null>(null)
  const run = async (stage: AutomationOverrideStage) => {
    setFeedback(null)
    try {
      const outcome = await roadmap.execute({
        type: 'start-automation-override',
        expectedConfigurationVersion: roadmap.configurationVersion,
        target: ticket,
        stage,
      })
      if (!outcome.ok) {
        setFeedback({ kind: 'error', text: outcome.error.message })
      } else if (outcome.result.admission === 'override' && outcome.result.status === 'admitted') {
        const result = outcome.result
        setFeedback({
          kind: 'notice',
          text: `${result.stage === 'classification' ? 'Classification' : 'Wayfinder'} override durably admitted for ticket ${result.target.ticketId}. Admission does not confirm process start or completion.`,
        })
      }
    } catch {
      setFeedback({
        kind: 'error',
        text: 'The Automation override admission outcome is unknown because its reply was lost. Roadmap will not retry it.',
      })
    }
  }

  return (
    <Surface>
      <SurfaceTitle>Automation</SurfaceTitle>
      {evidence && (
        <section className={cx('evidence')} aria-label="Recorded Automation evidence">
          <dl>
            <EvidenceFact
              term="Tracker state"
              value={result.tracker?.label ?? 'No source content known'}
            />
          </dl>
          <section>
            <h4>Classification</h4>
            <dl>
              {evidence.classification.facts.map((fact) => (
                <EvidenceFact key={fact.term} {...fact} />
              ))}
            </dl>
          </section>
          {evidence.session && (
            <section>
              <h4>Wayfinder Session</h4>
              <dl>
                {evidence.session.facts.map((fact) => (
                  <EvidenceFact key={fact.term} {...fact} />
                ))}
              </dl>
            </section>
          )}
        </section>
      )}
      <p className={cx('supporting')}>
        Start one eligible stage without changing global or Project Automation enablement.
      </p>
      <div className={cx('override-actions')}>
        <OverrideButton
          control={automation.controls.classification}
          commandInFlight={roadmap.command.inFlight}
          onClick={() => void run('classification')}
        />
        <OverrideButton
          control={automation.controls.wayfinder}
          commandInFlight={roadmap.command.inFlight}
          onClick={() => void run('wayfinder')}
        />
      </div>
      {feedback !== null &&
        (feedback.kind === 'error' ? (
          <Alert>{feedback.text}</Alert>
        ) : (
          <div role="status">
            <Alert variant="info">{feedback.text}</Alert>
          </div>
        ))}
    </Surface>
  )
}

type EvidenceFactProps = { term: string; value: string; detail?: string }

function EvidenceFact({ term, value, detail }: EvidenceFactProps) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>
        <strong>{value}</strong>
        {detail !== undefined && <span className={cx('evidence-detail')}>{detail}</span>}
      </dd>
    </div>
  )
}

type OverrideButtonProps = {
  control: AutomationControlResult
  commandInFlight: boolean
  onClick: () => void
}

function OverrideButton({ control, commandInFlight, onClick }: OverrideButtonProps) {
  const reason = commandInFlight
    ? 'Another operation is in progress.'
    : control.status === 'eligible'
      ? control.hint
      : control.reason
  return (
    <div className={cx('override-action')}>
      <Button
        size="small"
        disabled={commandInFlight || control.status !== 'eligible'}
        title={reason}
        onClick={onClick}
      >
        {control.label}
      </Button>
      <span className={cx('supporting')}>{reason}</span>
    </div>
  )
}
