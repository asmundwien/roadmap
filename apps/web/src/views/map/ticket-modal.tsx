import type {
  AutomationEvidence,
  AutomationOverrideControl,
  AutomationOverrideStage,
  AutomationProcessResult,
  Blocker,
  ClassificationAttempt,
  SessionReportEvidence,
  Ticket,
  WayfinderMap,
  WayfinderSession,
} from '@roadmap/contracts'
import { ticketTypeOf } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { Button } from '@roadmap/ui/button'
import { Link } from '@roadmap/ui/link'
import { Modal } from '@roadmap/ui/modal'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { useState } from 'react'
import { type RoadmapViewState, useRoadmap } from '@/store/roadmap-provider'
import { TicketMark } from '@/views/shared/ticket-mark'
import { TICKET_STATE_META } from '@/views/shared/ticket-presentation'
import { blockerNodeId } from './graph'
import { Prose } from './prose'
import styles from './ticket-modal.module.css'

const cx = classNames.bind(styles)

function automationEvidenceFor(
  map: WayfinderMap,
  ticket: Ticket,
  evidence: readonly AutomationEvidence[],
): AutomationEvidence | undefined {
  return evidence.find(
    (candidate) =>
      candidate.target.project.integration === map.project.integration &&
      candidate.target.project.id === map.project.id &&
      candidate.target.mapId === map.id &&
      candidate.target.ticketId === ticket.id,
  )
}

export type TicketModalProps = {
  map: WayfinderMap
  ticketId: string | null
  onClose: () => void
  onOpenTicket: (id: string) => void
  onOpenMap: () => void
}

export function TicketModal({ map, ticketId, onClose, onOpenTicket, onOpenMap }: TicketModalProps) {
  const roadmap = useRoadmap()
  const ticket = map.tickets.find((item) => item.id === ticketId)

  return (
    <Modal
      open={ticketId !== null}
      onClose={onClose}
      title={ticket?.title ?? ticket?.displayId ?? ticketId ?? 'Ticket'}
      className={cx('modal')}
    >
      {ticket === undefined ? (
        ticketId !== null && (
          <Alert variant="info">
            Ticket {ticketId} is absent from the current map snapshot. It may have been deleted or
            become unavailable.
            {!map.ticketsComplete && ' Some ticket records are missing from this map.'}
          </Alert>
        )
      ) : (
        <TicketContent
          key={`${map.project.integration}:${map.project.id}:${map.id}:${ticket.id}`}
          map={map}
          ticket={ticket}
          roadmap={roadmap}
          onOpenTicket={onOpenTicket}
          onOpenMap={onOpenMap}
        />
      )}
    </Modal>
  )
}

type AutomationViewState = Pick<
  RoadmapViewState,
  'automation' | 'configurationVersion' | 'command' | 'execute'
>

type TicketContentProps = {
  map: WayfinderMap
  ticket: Ticket
  roadmap: AutomationViewState
  onOpenTicket: (id: string) => void
  onOpenMap: () => void
}

function TicketContent({ map, ticket, roadmap, onOpenTicket, onOpenMap }: TicketContentProps) {
  const type = ticketTypeOf(ticket.typeEvidence)
  const stateMeta = TICKET_STATE_META[ticket.state]
  const decision = map.body.decisions.find((item) => item.title === ticket.title)
  const control = roadmap.automation.overrides.find(
    (item) =>
      item.target.project.integration === map.project.integration &&
      item.target.project.id === map.project.id &&
      item.target.mapId === map.id &&
      item.target.ticketId === ticket.id,
  )
  const evidence = automationEvidenceFor(map, ticket, roadmap.automation.evidence)
  const proseProps = { map, sourcePath: ticket.sourcePath, onOpenTicket, onOpenMap }

  return (
    <div className={cx('content')}>
      <div className={cx('identity')}>
        <span>{ticket.displayId ?? ticket.id}</span>
        <Badge>{type}</Badge>
        <Badge variant={stateMeta.variant}>
          <TicketMark state={ticket.state} type={type} size="small" />
          {trackerStateLabel(ticket)}
        </Badge>
      </div>
      {ticket.url && (
        <Link href={ticket.url} external>
          View item in source
        </Link>
      )}
      {(ticket.assignees.length > 0 || ticket.closedAt !== undefined) && (
        <dl className={cx('metadata')}>
          {ticket.assignees.length > 0 && (
            <div>
              <dt>Assignees</dt>
              <dd>
                {ticket.assignees.map((assignee, index) => (
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
          {ticket.closedAt !== undefined && (
            <div>
              <dt>Closed</dt>
              <dd>
                {new Date(ticket.closedAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </dd>
            </div>
          )}
        </dl>
      )}
      {ticket.body.trim() !== '' && <Prose {...proseProps} markdown={ticket.body} />}
      {decision !== undefined && (
        <Surface variant="subtle">
          <SurfaceTitle>The decision</SurfaceTitle>
          <Prose {...proseProps} markdown={decision.gist} />
        </Surface>
      )}
      {ticket.blockedBy.length > 0 && (
        <Surface variant="subtle">
          <SurfaceTitle>Blocked by</SurfaceTitle>
          <ul className={cx('blockers')}>
            {ticket.blockedBy.map((blocker) => (
              <li key={blockerNodeId(blocker)}>
                <BlockerItem map={map} blocker={blocker} onOpenTicket={onOpenTicket} />
              </li>
            ))}
          </ul>
        </Surface>
      )}
      {!ticket.blockersComplete && (
        <Alert variant="info">Some blockers could not be resolved.</Alert>
      )}
      {!map.ticketsComplete && (
        <Alert variant="info">Some ticket records are missing from this map.</Alert>
      )}
      {ticket.warnings.map((warning) => (
        <Alert key={warning} variant="info">
          {warning}
        </Alert>
      ))}
      <AutomationSection
        roadmap={roadmap}
        control={control}
        evidence={evidence}
        map={map}
        ticket={ticket}
      />
    </div>
  )
}

type BlockerItemProps = {
  map: WayfinderMap
  blocker: Blocker
  onOpenTicket: (id: string) => void
}

function BlockerItem({ map, blocker, onOpenTicket }: BlockerItemProps) {
  const { reference } = blocker
  const local =
    reference.kind === 'registered' &&
    reference.project.integration === map.project.integration &&
    reference.project.id === map.project.id
      ? map.tickets.find((ticket) => ticket.id === blocker.ticketId)
      : undefined
  const scope =
    reference.kind === 'registered'
      ? `${reference.project.integration}:${reference.project.id}`
      : reference.kind === 'external'
        ? `${reference.integration}:${reference.nameWithOwner}`
        : reference.locator
  const identity = blocker.displayId ?? blocker.ticketId
  const title = blocker.title ?? identity

  if (local !== undefined) {
    return (
      <div className={cx('blocker')}>
        <Button size="small" onClick={() => onOpenTicket(local.id)}>
          {local.title ?? local.displayId ?? local.id}
        </Button>
        <Badge variant={TICKET_STATE_META[local.state].variant}>
          <TicketMark state={local.state} type={ticketTypeOf(local.typeEvidence)} size="small" />
          {trackerStateLabel(local)}
        </Badge>
      </div>
    )
  }
  return (
    <div className={cx('blocker')}>
      {blocker.url ? (
        <Link href={blocker.url} external>
          {title}
        </Link>
      ) : (
        <span>{title}</span>
      )}
      <span className={cx('supporting')}>
        {scope} · {identity} · {blocker.state}
        {blocker.url ? ' · source' : ' · No source link is available.'}
        {blocker.state === 'unknown' && ' Blocker state is unknown.'}
      </span>
    </div>
  )
}

type AutomationSectionProps = {
  roadmap: AutomationViewState
  control: AutomationOverrideControl | undefined
  evidence: AutomationEvidence | undefined
  map: WayfinderMap
  ticket: Ticket
}

function AutomationSection({ roadmap, control, evidence, map, ticket }: AutomationSectionProps) {
  const [feedback, setFeedback] = useState<{ kind: 'notice' | 'error'; text: string } | null>(null)
  const fallbackReason =
    roadmap.automation.availability.status === 'unavailable'
      ? roadmap.automation.availability.cause
      : 'Automation overrides are unavailable for this ticket.'

  const run = async (stage: AutomationOverrideStage) => {
    setFeedback(null)
    try {
      const outcome = await roadmap.execute({
        type: 'start-automation-override',
        expectedConfigurationVersion: roadmap.configurationVersion,
        target: { project: map.project, mapId: map.id, ticketId: ticket.id },
        stage,
      })
      setFeedback(
        outcome.ok
          ? {
              kind: 'notice',
              text:
                stage === 'classification'
                  ? 'Classification Run started.'
                  : 'Wayfinder Session started.',
            }
          : { kind: 'error', text: outcome.error.message },
      )
    } catch {
      setFeedback({
        kind: 'error',
        text: 'The Automation override may have been admitted. Check its recorded stage evidence before another attempt.',
      })
    }
  }

  return (
    <Surface>
      <SurfaceTitle>Automation</SurfaceTitle>
      {evidence !== undefined && (
        <section className={cx('evidence')} aria-label="Recorded Automation evidence">
          <dl>
            <EvidenceFact term="Tracker state" value={trackerStateLabel(ticket)} />
          </dl>
          <ClassificationEvidence attempt={evidence.classification} />
          {evidence.wayfinder !== undefined && <WayfinderEvidence session={evidence.wayfinder} />}
        </section>
      )}
      <p className={cx('supporting')}>
        Start one eligible stage without changing global or Project Automation enablement.
      </p>
      <div className={cx('override-actions')}>
        <OverrideButton
          label="Run Classification"
          available={control?.classification}
          fallbackReason={fallbackReason}
          commandInFlight={roadmap.command.inFlight}
          eligibleHint="Classify this ticket once."
          onClick={() => void run('classification')}
        />
        <OverrideButton
          label="Start Wayfinder Session"
          available={control?.wayfinder}
          fallbackReason={fallbackReason}
          commandInFlight={roadmap.command.inFlight}
          eligibleHint="Start the AFK-approved ticket once."
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

type ClassificationEvidenceProps = { attempt: ClassificationAttempt }

function ClassificationEvidence({ attempt }: ClassificationEvidenceProps) {
  return (
    <section>
      <h4>Classification</h4>
      <dl>
        <EvidenceFact term="State" value={classificationStateLabel(attempt)} />
        <EvidenceFact
          term="Admission"
          value={attempt.admission === 'automatic' ? 'Automatic' : 'Override'}
        />
        {(attempt.status === 'completed' || attempt.status === 'failed') && (
          <ProcessEvidence result={attempt.processResult} />
        )}
        {attempt.status === 'completed' && (
          <EvidenceFact
            term="Verdict"
            value={attempt.verdict.value.toUpperCase()}
            detail={attempt.verdict.reason}
          />
        )}
        {(attempt.status === 'failed' ||
          attempt.status === 'launch-failed' ||
          attempt.status === 'outcome-unknown') && (
          <EvidenceFact term="Reason" value={attempt.reason} />
        )}
      </dl>
    </section>
  )
}

type WayfinderEvidenceProps = { session: WayfinderSession }

function WayfinderEvidence({ session }: WayfinderEvidenceProps) {
  return (
    <section>
      <h4>Wayfinder Session</h4>
      <dl>
        <EvidenceFact term="State" value={wayfinderStateLabel(session)} />
        <EvidenceFact
          term="Admission"
          value={
            session.status === 'queued'
              ? 'Pending'
              : session.admission === 'automatic'
                ? 'Automatic'
                : 'Override'
          }
        />
        {session.status === 'finished' && (
          <>
            <ProcessEvidence result={session.processResult} />
            <ReportEvidence report={session.report} />
          </>
        )}
        {(session.status === 'launch-failed' || session.status === 'outcome-unknown') && (
          <EvidenceFact term="Reason" value={session.reason} />
        )}
        {session.status === 'outcome-unknown' && (
          <EvidenceFact
            term="Acknowledgement"
            value={session.acknowledged ? 'Acknowledged' : 'Required'}
          />
        )}
      </dl>
    </section>
  )
}

type ProcessEvidenceProps = { result: AutomationProcessResult }

function ProcessEvidence({ result }: ProcessEvidenceProps) {
  switch (result.status) {
    case 'exited':
      return <EvidenceFact term="Process result" value={`Exited ${result.code}`} />
    case 'signaled':
      return <EvidenceFact term="Process result" value={`Ended by ${result.signal}`} />
    case 'unavailable':
      return <EvidenceFact term="Process result" value="Unavailable" detail={result.reason} />
    default: {
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

type ReportEvidenceProps = { report: SessionReportEvidence }

function ReportEvidence({ report }: ReportEvidenceProps) {
  switch (report.status) {
    case 'received':
      return (
        <EvidenceFact
          term="Session report"
          value={sentenceCase(report.report.outcome)}
          detail={report.report.reason}
        />
      )
    case 'missing':
      return <EvidenceFact term="Session report" value="Missing" detail={report.reason} />
    case 'invalid':
      return <EvidenceFact term="Session report" value="Invalid" detail={report.reason} />
    default: {
      const _exhaustive: never = report
      return _exhaustive
    }
  }
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
  label: string
  available: AutomationOverrideControl['classification'] | undefined
  fallbackReason: string
  commandInFlight: boolean
  eligibleHint: string
  onClick: () => void
}

function OverrideButton({
  label,
  available,
  fallbackReason,
  commandInFlight,
  eligibleHint,
  onClick,
}: OverrideButtonProps) {
  const reason = commandInFlight
    ? 'Another operation is in progress.'
    : available?.status === 'ineligible'
      ? available.reason
      : available === undefined
        ? fallbackReason
        : eligibleHint
  return (
    <div className={cx('override-action')}>
      <Button
        size="small"
        disabled={commandInFlight || available?.status !== 'eligible'}
        title={reason}
        onClick={onClick}
      >
        {label}
      </Button>
      <span className={cx('supporting')}>{reason}</span>
    </div>
  )
}

function classificationStateLabel(attempt: ClassificationAttempt): string {
  switch (attempt.status) {
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'launch-failed':
      return 'Launch failed'
    case 'outcome-unknown':
      return 'Outcome unknown'
    default: {
      const _exhaustive: never = attempt
      return _exhaustive
    }
  }
}

function wayfinderStateLabel(session: WayfinderSession): string {
  switch (session.status) {
    case 'queued':
      return 'Queued'
    case 'launching':
      return 'Launching'
    case 'running':
      return 'Running'
    case 'finished':
      return 'Finished'
    case 'launch-failed':
      return 'Launch failed'
    case 'outcome-unknown':
      return 'Outcome unknown'
    default: {
      const _exhaustive: never = session
      return _exhaustive
    }
  }
}

function trackerStateLabel(ticket: Ticket): string {
  if (ticket.state === 'closed') return sentenceCase(TICKET_STATE_META.closed.word)
  if (ticket.isBlocked && ticket.isClaimed) return 'Blocked + claimed'
  return sentenceCase(TICKET_STATE_META[ticket.state].word)
}

function sentenceCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
