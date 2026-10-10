import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { Link } from '@/navigation'
import type { RoadmapWorkflows, WorkflowFeedbackResult } from '@/workflows/workflows'

type WorkflowFeedbackProps = {
  feedback: WorkflowFeedbackResult
  workflows: Pick<RoadmapWorkflows, 'dismiss'>
}

export function WorkflowFeedback({ feedback, workflows }: WorkflowFeedbackProps) {
  const current = feedback.current
  const visibleCurrent = current !== null && !current.dismissed
  const message = visibleCurrent ? feedback.message : null
  const error = visibleCurrent ? feedback.error : null
  const destination = visibleCurrent ? feedback.destination : null
  const olderUnknown = feedback.unknown.filter(
    (attempt) => !attempt.dismissed && attempt.id !== current?.id,
  )
  const destinationLabel =
    current?.operation === 'register-project' || current?.operation === 'repair-project-workspace'
      ? 'Open Project settings'
      : current?.operation === 'remove-connection'
        ? 'Back to Connections'
        : current?.operation === 'remove-project'
          ? 'Back to Connection'
          : 'Open Connection'

  return (
    <>
      {visibleCurrent && (message || error || destination) && (
        <Alert variant={error ? 'error' : 'info'}>
          {message && <span>{message}</span>}
          {error && error.message !== message && <span>{error.message}</span>}
          {destination && <Link href={destination}>{destinationLabel}</Link>}
          {current.kind === 'completion-unknown' && (
            <Button type="button" onClick={() => workflows.dismiss({ attemptId: current.id })}>
              Dismiss notice
            </Button>
          )}
        </Alert>
      )}
      {olderUnknown.map((attempt) => (
        <Alert key={attempt.id}>
          <span>{attempt.message}</span>
          <Button type="button" onClick={() => workflows.dismiss({ attemptId: attempt.id })}>
            Dismiss notice
          </Button>
        </Alert>
      ))}
    </>
  )
}
