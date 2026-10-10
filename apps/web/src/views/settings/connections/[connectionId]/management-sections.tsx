import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import { useState } from 'react'
import { type ConnectionSummary, resolveConnection } from '@/resources/results'
import { useRoadmap } from '@/store/roadmap-provider'
import { AuthorizationControls, DeviceCode } from '@/views/shared/authorization-presentation'
import {
  authorizationFeedback,
  authorizationPhaseStatus,
  workflowFeedback,
} from '@/workflows/workflows'

type AuthorizationGroupProps = { connection: ConnectionSummary }

export function AuthorizationGroup({ connection }: AuthorizationGroupProps) {
  const { workflows, presentation, result, reauthorization, retry, cancellation } = useRoadmap(
    (roadmap) => {
      const currentConnection = resolveConnection(roadmap, connection.id)
      const presentation =
        currentConnection.kind === 'known' ? currentConnection.currentAuthorization : null
      const reauthorization = workflowFeedback(
        roadmap.workflowState,
        'reauthorize-github-connection',
        {
          kind: 'connection',
          connectionId: connection.id,
        },
      )
      const attempt = reauthorization.current
      const returnedOperationId =
        attempt?.kind === 'acknowledged' && attempt.operation === 'reauthorize-github-connection'
          ? attempt.result.operationId
          : undefined
      const returnedFeedback = returnedOperationId
        ? authorizationFeedback(roadmap.workflowState, returnedOperationId)
        : null
      const feedback =
        returnedFeedback && !returnedFeedback.consumed
          ? returnedFeedback
          : presentation
            ? authorizationFeedback(roadmap.workflowState, presentation.id)
            : null
      const result = feedback && !feedback.consumed ? feedback.result : null
      const operationId = result?.operationId ?? presentation?.id
      return {
        workflows: roadmap.workflows,
        presentation,
        result,
        reauthorization,
        retry: operationId
          ? workflowFeedback(roadmap.workflowState, 'retry-github-authorization', {
              kind: 'authorization',
              operationId,
            })
          : null,
        cancellation: operationId
          ? workflowFeedback(roadmap.workflowState, 'cancel-github-authorization', {
              kind: 'authorization',
              operationId,
            })
          : null,
      }
    },
  )
  const operationId = result?.operationId ?? presentation?.id
  const canRetry = result
    ? result.phase !== 'granted' && result.phase !== 'cancelled'
    : presentation &&
      presentation.kind !== 'granted-current' &&
      presentation.kind !== 'granted-historical' &&
      !(presentation.kind === 'terminal' && presentation.outcome === 'cancelled')
  const actionFeedback = canRetry && operationId ? retry : reauthorization
  const reauthenticate = () => {
    if (canRetry && operationId) {
      void workflows.retryAuthorization({ operationId })
    } else {
      void workflows.reauthorizeConnection({ connectionId: connection.id })
    }
  }
  const waiting = result
    ? result.phase === 'waiting'
      ? result
      : null
    : presentation?.kind === 'waiting'
      ? presentation
      : null
  return (
    <Surface variant="subtle">
      <SurfaceTitle>GitHub authorization</SurfaceTitle>
      {waiting && operationId ? (
        <>
          <p>
            {result
              ? authorizationPhaseStatus('waiting')
              : 'Waiting for GitHub. Authorization progress is live server state.'}
          </p>
          <DeviceCode>
            <small>{waiting.verificationUri}</small>
            <strong>{waiting.userCode}</strong>
            <span>{`Expires ${new Date(waiting.expiresAt).toLocaleTimeString()}`}</span>
          </DeviceCode>
          <AuthorizationControls>
            <Link href={waiting.verificationUri} external>
              Open GitHub
            </Link>
            <ControlGroup>
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(waiting.userCode)
                }}
              >
                Copy code
              </Button>
              <Button
                type="button"
                disabled={!cancellation || cancellation.blocked || cancellation.pending}
                onClick={() => void workflows.cancelAuthorization({ operationId })}
              >
                Cancel authorization
              </Button>
            </ControlGroup>
          </AuthorizationControls>
        </>
      ) : (
        <>
          {!result &&
            presentation &&
            presentation.kind === 'terminal' &&
            presentation.outcome !== 'cancelled' && (
              <Alert>
                <strong>{presentation.label}</strong>
                <span>{presentation.cause}</span>
              </Alert>
            )}
          <Button
            type="button"
            disabled={!actionFeedback || actionFeedback.blocked || actionFeedback.pending}
            onClick={reauthenticate}
          >
            {canRetry ? 'Retry authorization' : 'Reauthenticate'}
          </Button>
        </>
      )}
    </Surface>
  )
}

type RemoveConnectionGroupProps = {
  connection: ConnectionSummary
  onRemove: () => void
}

export function RemoveConnectionGroup({ connection, onRemove }: RemoveConnectionGroupProps) {
  const { feedback, dependentCount } = useRoadmap((roadmap) => {
    const currentConnection = resolveConnection(roadmap, connection.id)
    return {
      feedback: workflowFeedback(roadmap.workflowState, 'remove-connection', {
        kind: 'connection',
        connectionId: connection.id,
      }),
      dependentCount: currentConnection.kind === 'known' ? currentConnection.projectCount : 0,
    }
  })
  const blocked = feedback.blocked || feedback.pending
  const [confirming, setConfirming] = useState(false)

  return (
    <Surface variant="danger">
      <SurfaceTitle>Remove connection</SurfaceTitle>
      {dependentCount > 0 ? (
        <>
          <p>
            Remove every dependent Project registration first. Reassignment and cascade removal are
            unavailable.
          </p>
          <Button variant="danger" type="button" disabled>
            Remove connection
          </Button>
        </>
      ) : confirming ? (
        <>
          <p>External GitHub authorization and repositories remain unchanged.</p>
          <ControlGroup>
            <Button type="button" onClick={() => setConfirming(false)}>
              Keep connection
            </Button>
            <Button
              variant="danger"
              appearance="solid"
              type="button"
              disabled={blocked}
              onClick={() => void onRemove()}
            >
              Confirm removal
            </Button>
          </ControlGroup>
        </>
      ) : (
        <Button
          variant="danger"
          type="button"
          disabled={blocked}
          onClick={() => setConfirming(true)}
        >
          Remove connection
        </Button>
      )}
    </Surface>
  )
}
