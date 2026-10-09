import type { ConfigurationVersion, ConnectionId } from '@roadmap/contracts/identity'
import type { Command } from '@roadmap/contracts/operations'
import type { AuthorizationOperation, Connection, Project } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { routePaths } from '@/router'
import { authorizationStatus } from '@/views/settings/connections/connection-details'
import { AuthorizationControls, DeviceCode } from '@/views/shared/authorization-presentation'

type RunCommand = (command: Command) => Promise<boolean>

type AuthorizationGroupProps = {
  connection: Connection
  authorization: AuthorizationOperation | undefined
  configurationVersion: ConfigurationVersion
  blocked: boolean
  run: RunCommand
}

export function AuthorizationGroup({
  connection,
  authorization,
  configurationVersion,
  blocked,
  run,
}: AuthorizationGroupProps) {
  const reauthenticate = () => {
    if (
      authorization &&
      authorization.status !== 'granted' &&
      !(authorization.status === 'terminal' && authorization.outcome === 'cancelled')
    ) {
      void run({
        type: 'retry-github-authorization',
        expectedConfigurationVersion: configurationVersion,
        operationId: authorization.id,
      })
      return
    }
    void run({
      type: 'begin-github-authorization',
      expectedConfigurationVersion: configurationVersion,
      connectionId: connection.id,
      name: connection.name,
    })
  }

  return (
    <Surface variant="subtle">
      <SurfaceTitle>GitHub authorization</SurfaceTitle>
      {authorization?.status === 'waiting' ? (
        <>
          <p>Waiting for GitHub. Authorization progress is live server state.</p>
          <DeviceCode>
            <small>{authorization.verificationUri}</small>
            <strong>{authorization.userCode}</strong>
            <span>{`Expires ${new Date(authorization.expiresAt).toLocaleTimeString()}`}</span>
          </DeviceCode>
          <AuthorizationControls>
            <Link href={authorization.verificationUri} external>
              Open GitHub
            </Link>
            <ControlGroup>
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(authorization.userCode)
                }}
              >
                Copy code
              </Button>
              <Button
                type="button"
                disabled={blocked}
                onClick={() =>
                  void run({
                    type: 'cancel-github-authorization',
                    expectedConfigurationVersion: configurationVersion,
                    operationId: authorization.id,
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
          {authorization &&
            authorization.status !== 'granted' &&
            !(authorization.status === 'terminal' && authorization.outcome === 'cancelled') && (
              <Alert>
                <strong>{authorizationStatus(authorization)}</strong>
                <span>{'cause' in authorization ? authorization.cause : undefined}</span>
              </Alert>
            )}
          <Button type="button" disabled={blocked} onClick={reauthenticate}>
            {authorization &&
            authorization.status !== 'granted' &&
            !(authorization.status === 'terminal' && authorization.outcome === 'cancelled')
              ? 'Retry authorization'
              : 'Reauthenticate'}
          </Button>
        </>
      )}
    </Surface>
  )
}

type RemoveConnectionGroupProps = {
  connectionId: ConnectionId
  dependents: Project[]
  configurationVersion: ConfigurationVersion
  blocked: boolean
  run: RunCommand
}

export function RemoveConnectionGroup({
  connectionId,
  dependents,
  configurationVersion,
  blocked,
  run,
}: RemoveConnectionGroupProps) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const remove = async () => {
    const removed = await run({
      type: 'remove-connection',
      expectedConfigurationVersion: configurationVersion,
      connectionId,
    })
    if (removed) navigate(routePaths.connections, { replace: true })
  }

  return (
    <Surface variant="danger">
      <SurfaceTitle>Remove connection</SurfaceTitle>
      {dependents.length > 0 ? (
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
              onClick={() => void remove()}
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
