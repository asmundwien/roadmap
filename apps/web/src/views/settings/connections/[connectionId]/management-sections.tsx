import type { ConfigurationVersion } from '@roadmap/contracts/identity'
import type { Command, CommandResultFor } from '@roadmap/contracts/operations'
import type { AuthorizationOperation } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import { useRef, useState } from 'react'
import type { AuthorizationResult, ConnectionSummary } from '@/resources/results'
import {
  type AuthorizationResultFeedback,
  authorizationResultPending,
  consumeAuthorizationFeedback,
} from '@/views/settings/connections/connection-details'
import { AuthorizationControls, DeviceCode } from '@/views/shared/authorization-presentation'

type RunCommand = <C extends Command>(command: C) => Promise<CommandResultFor<C> | null>
type AuthorizationCommand = Extract<
  Command,
  {
    type:
      | 'reauthorize-github-connection'
      | 'retry-github-authorization'
      | 'cancel-github-authorization'
  }
>

type AuthorizationGroupProps = {
  connection: ConnectionSummary
  authorization: AuthorizationOperation | undefined
  presentation: AuthorizationResult | null
  configurationVersion: ConfigurationVersion
  blocked: boolean
  run: RunCommand
}

export function AuthorizationGroup({
  connection,
  authorization,
  presentation,
  configurationVersion,
  blocked,
  run,
}: AuthorizationGroupProps) {
  const [feedback, setFeedback] = useState<AuthorizationResultFeedback | null>(null)
  const currentAuthorization = useRef(authorization)
  currentAuthorization.current = authorization
  const reconciledFeedback = feedback ? consumeAuthorizationFeedback(authorization, feedback) : null
  if (reconciledFeedback !== feedback) setFeedback(reconciledFeedback)
  const result = authorizationResultPending(authorization, reconciledFeedback)
    ? reconciledFeedback?.result
    : null
  const perform = async <C extends AuthorizationCommand>(command: C) => {
    const next = await run(command)
    if (next) {
      setFeedback(
        consumeAuthorizationFeedback(currentAuthorization.current, {
          result: next,
          previous: authorization,
          consumed: currentAuthorization.current !== authorization,
        }),
      )
    }
  }
  const reauthenticate = () => {
    const operationId = result?.operationId ?? authorization?.id
    const retry = result
      ? result.phase !== 'granted' && result.phase !== 'cancelled'
      : presentation &&
        presentation.kind !== 'granted-current' &&
        presentation.kind !== 'granted-historical' &&
        !(presentation.kind === 'terminal' && presentation.outcome === 'cancelled')
    if (retry && operationId) {
      void perform({
        type: 'retry-github-authorization',
        expectedConfigurationVersion: configurationVersion,
        operationId,
      })
      return
    }
    void perform({
      type: 'reauthorize-github-connection',
      expectedConfigurationVersion: configurationVersion,
      connectionId: connection.id,
    })
  }
  const waiting = result
    ? result.phase === 'waiting'
      ? result
      : null
    : presentation?.kind === 'waiting'
      ? presentation
      : null
  const waitingOperationId = result?.operationId ?? authorization?.id

  return (
    <Surface variant="subtle">
      <SurfaceTitle>GitHub authorization</SurfaceTitle>
      {result && result.phase !== 'waiting' && (
        <Alert variant={result.phase === 'granted' ? 'info' : undefined}>
          {result.phase === 'granted'
            ? `Connection ${result.connection.connectionId} authorized at configuration version ${result.configurationVersion}.`
            : result.phase === 'failed' || result.phase === 'denied'
              ? result.error.message
              : result.phase === 'expired'
                ? 'GitHub authorization expired.'
                : 'GitHub authorization cancelled. Existing credentials and provider authorization remain unchanged.'}
        </Alert>
      )}
      {waiting && waitingOperationId ? (
        <>
          <p>Waiting for GitHub. Authorization progress is live server state.</p>
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
                disabled={blocked}
                onClick={() =>
                  void perform({
                    type: 'cancel-github-authorization',
                    expectedConfigurationVersion: configurationVersion,
                    operationId: waitingOperationId,
                  })
                }
              >
                Cancel authorization
              </Button>
            </ControlGroup>
          </AuthorizationControls>
        </>
      ) : (
        <>
          {!result &&
            authorization &&
            presentation &&
            presentation.kind === 'terminal' &&
            presentation.outcome !== 'cancelled' && (
              <Alert>
                <strong>{presentation.label}</strong>
                <span>{presentation.cause}</span>
              </Alert>
            )}
          <Button type="button" disabled={blocked} onClick={reauthenticate}>
            {(
              result
                ? result.phase !== 'granted' && result.phase !== 'cancelled'
                : presentation &&
                  presentation.kind !== 'granted-current' &&
                  presentation.kind !== 'granted-historical' &&
                  !(presentation.kind === 'terminal' && presentation.outcome === 'cancelled')
            )
              ? 'Retry authorization'
              : 'Reauthenticate'}
          </Button>
        </>
      )}
    </Surface>
  )
}

type RemoveConnectionGroupProps = {
  dependentCount: number
  blocked: boolean
  onRemove: () => Promise<void>
}

export function RemoveConnectionGroup({
  dependentCount,
  blocked,
  onRemove,
}: RemoveConnectionGroupProps) {
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
