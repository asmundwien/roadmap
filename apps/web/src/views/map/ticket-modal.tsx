import type {
  AutomationEvidence,
  AutomationOverrideControl,
  AutomationOverrideStage,
  AutomationProcessResult,
  Blocker,
  ClassificationAttempt,
  MapResource,
  SessionReportEvidence,
  TicketResource,
  TicketResourceResult,
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
import { resourceMessage, resourceObservation } from '@/views/shared/resource-results'
import { TicketMark } from '@/views/shared/ticket-mark'
import { TICKET_STATE_META } from '@/views/shared/ticket-presentation'
import { blockerNodeId } from './graph'
import { Prose } from './prose'
import styles from './ticket-modal.module.css'

const cx = classNames.bind(styles)

type TicketValue = Extract<
  TicketResourceResult,
  { kind: 'current-readable' }
>['observation']['value']

function automationEvidenceFor(
  ticket: TicketResource['key'],
  evidence: readonly AutomationEvidence[],
): AutomationEvidence | undefined {
  return evidence.find(
    (candidate) =>
      candidate.target.project.integration === ticket.map.project.integration &&
      candidate.target.project.id === ticket.map.project.id &&
      candidate.target.mapId === ticket.map.mapId &&
      candidate.target.ticketId === ticket.ticketId,
  )
}

export type TicketModalProps = {
  map: MapResource
  ticketId: string | null
  onClose: () => void
  onOpenTicket: (id: string) => void
  onOpenMap: () => void
}

export function TicketModal({ map, ticketId, onClose, onOpenTicket, onOpenMap }: TicketModalProps) {
  const roadmap = useRoadmap()
  const ticket = map.tickets.find((item) => item.key.ticketId === ticketId)
  const content = ticket === undefined ? null : resourceObservation(ticket.resource)?.value

  return (
    <Modal
      open={ticketId !== null}
      onClose={onClose}
      title={content?.title ?? content?.displayId ?? ticketId ?? 'Ticket'}
      className={cx('modal')}
    >
      {ticket === undefined ? (
        ticketId !== null && (
          <>
            <Alert variant="info">
              Ticket {ticketId} has no known resource in this map. No other ticket has been
              selected.
            </Alert>
            <TicketAutomation
              roadmap={roadmap}
              ticket={{ map: map.key, ticketId }}
              tracker={undefined}
            />
          </>
        )
      ) : (
        <>
          <Alert variant="info">Ticket source. {resourceMessage(ticket.resource)}</Alert>
          <TicketContent
            key={JSON.stringify([
              map.key.project.integration,
              map.key.project.id,
              map.key.mapId,
              ticket.key.ticketId,
            ])}
            map={map}
            ticketResource={ticket}
            roadmap={roadmap}
            onOpenTicket={onOpenTicket}
            onOpenMap={onOpenMap}
          />
        </>
      )}
    </Modal>
  )
}

type AutomationViewState = Pick<
  RoadmapViewState,
  'automation' | 'configurationVersion' | 'command' | 'execute'
>

type TicketContentProps = {
  map: MapResource
  ticketResource: TicketResource
  roadmap: AutomationViewState
  onOpenTicket: (id: string) => void
  onOpenMap: () => void
}

function TicketContent({
  map,
  ticketResource,
  roadmap,
  onOpenTicket,
  onOpenMap,
}: TicketContentProps) {
  const ticket = resourceObservation(ticketResource.resource)?.value
  if (ticket === undefined) {
    return <TicketAutomation roadmap={roadmap} ticket={ticketResource.key} tracker={undefined} />
  }
  const type = ticketTypeOf(ticket.typeEvidence)
  const stateMeta = TICKET_STATE_META[ticket.state]
  const decision = resourceObservation(map.resource)?.value.body.decisions.find(
    (item) => item.title === ticket.title,
  )
  const proseProps = {
    map,
    sourcePath: ticket.source.kind === 'file' ? ticket.source.path : undefined,
    onOpenTicket,
    onOpenMap,
  }

  return (
    <div className={cx('content')}>
      <div className={cx('identity')}>
        <span>{ticket.displayId ?? ticketResource.key.ticketId}</span>
        <Badge>{type}</Badge>
        <Badge variant={stateMeta.variant}>
          <TicketMark state={ticket.state} type={type} size="small" />
          {trackerStateLabel(ticket)}
        </Badge>
      </div>
      {ticket.source.kind === 'issue' ? (
        <Link href={ticket.source.url} external>
          View item in source
        </Link>
      ) : (
        <p className={cx('supporting')}>{ticket.source.path}</p>
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
      {map.ticketsMembership.kind !== 'current-complete' && (
        <Alert variant="info">
          Current ticket membership is not complete. Known traces do not prove current presence.
        </Alert>
      )}
      {ticket.warnings.map((warning) => (
        <Alert key={warning} variant="info">
          {warning}
        </Alert>
      ))}
      <TicketAutomation roadmap={roadmap} ticket={ticketResource.key} tracker={ticket} />
    </div>
  )
}

type BlockerItemProps = {
  map: MapResource
  blocker: Blocker
  onOpenTicket: (id: string) => void
}

function BlockerItem({ map, blocker, onOpenTicket }: BlockerItemProps) {
  const { reference } = blocker
  const local =
    reference.kind === 'registered' &&
    reference.project.integration === map.key.project.integration &&
    reference.project.id === map.key.project.id
      ? map.tickets.find((ticket) => ticket.key.ticketId === blocker.ticketId)
      : undefined
  const scope =
    reference.kind === 'registered'
      ? `${reference.project.integration}:${reference.project.id}`
      : reference.kind === 'external'
        ? `${reference.integration}:${reference.nameWithOwner}`
        : reference.locator
  const identity = blocker.displayId ?? blocker.ticketId
  const localContent = local === undefined ? null : resourceObservation(local.resource)?.value
  const title = blocker.title ?? identity

  if (local !== undefined) {
    return (
      <div className={cx('blocker')}>
        <Button size="small" onClick={() => onOpenTicket(local.key.ticketId)}>
          {localContent?.title ?? localContent?.displayId ?? local.key.ticketId}
        </Button>
        {localContent && (
          <Badge variant={TICKET_STATE_META[localContent.state].variant}>
            <TicketMark
              state={localContent.state}
              type={ticketTypeOf(localContent.typeEvidence)}
              size="small"
            />
            {trackerStateLabel(localContent)}
          </Badge>
        )}
        {local.resource.kind !== 'current-readable' && (
          <span className={cx('supporting')}>{resourceMessage(local.resource)}</span>
        )}
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

type TicketAutomationProps = {
  roadmap: AutomationViewState
  ticket: TicketResource['key']
  tracker: TicketValue | undefined
}

function TicketAutomation({ roadmap, ticket, tracker }: TicketAutomationProps) {
  const control = roadmap.automation.overrides.find(
    (item) =>
      item.target.project.integration === ticket.map.project.integration &&
      item.target.project.id === ticket.map.project.id &&
      item.target.mapId === ticket.map.mapId &&
      item.target.ticketId === ticket.ticketId,
  )
  const evidence = automationEvidenceFor(ticket, roadmap.automation.evidence)
  return (
    <AutomationSection
      roadmap={roadmap}
      control={control}
      evidence={evidence}
      ticket={ticket}
      tracker={tracker}
    />
  )
}

type AutomationSectionProps = {
  roadmap: AutomationViewState
  control: AutomationOverrideControl | undefined
  evidence: AutomationEvidence | undefined
  ticket: TicketResource['key']
  tracker: TicketValue | undefined
}

function AutomationSection({
  roadmap,
  control,
  evidence,
  ticket,
  tracker,
}: AutomationSectionProps) {
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
        target: { project: ticket.map.project, mapId: ticket.map.mapId, ticketId: ticket.ticketId },
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
            <EvidenceFact
              term="Tracker state"
              value={tracker === undefined ? 'No source content known' : trackerStateLabel(tracker)}
            />
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

function trackerStateLabel(ticket: TicketValue): string {
  if (ticket.state === 'closed') return sentenceCase(TICKET_STATE_META.closed.word)
  if (ticket.isBlocked && ticket.isClaimed) return 'Blocked + claimed'
  return sentenceCase(TICKET_STATE_META[ticket.state].word)
}

function sentenceCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
