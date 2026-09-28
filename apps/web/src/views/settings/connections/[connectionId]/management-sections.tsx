import type {
  AuthorizationOperation,
  Command,
  Connection,
  RegisteredProject,
} from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { SectionGroup, SectionGroupTitle } from '@roadmap/ui/section'
import { useState } from 'react'
import { connectionSettingsHash } from '@/router'

type RunCommand = (command: Command) => Promise<boolean>

type AuthorizationGroupProps = {
  connection: Connection
  authorization: AuthorizationOperation | undefined
  configurationVersion: number
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
      authorization.status !== 'cancelled'
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
    <SectionGroup>
      <SectionGroupTitle>GitHub authorization</SectionGroupTitle>
      {authorization?.status === 'waiting' ? (
        <>
          <p>Waiting for GitHub. Authorization progress is live server state.</p>
          <div className="device-code">
            <small>{authorization.verificationUri}</small>
            <strong>{authorization.userCode}</strong>
            <span>
              {authorization.expiresAt
                ? `Expires ${new Date(authorization.expiresAt).toLocaleTimeString()}`
                : 'Waiting for GitHub'}
            </span>
          </div>
          <div className="authorization-controls">
            {authorization.verificationUri && (
              <Link href={authorization.verificationUri} external>
                Open GitHub
              </Link>
            )}
            <ControlGroup>
              <Button
                type="button"
                disabled={!authorization.userCode}
                onClick={() => {
                  if (authorization.userCode)
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
          </div>
        </>
      ) : (
        <>
          {authorization &&
            authorization.status !== 'granted' &&
            authorization.status !== 'cancelled' && (
              <Alert>
                <strong>Authorization {authorization.status}</strong>
                <span>{authorization.cause}</span>
              </Alert>
            )}
          <Button type="button" disabled={blocked} onClick={reauthenticate}>
            {authorization &&
            authorization.status !== 'granted' &&
            authorization.status !== 'cancelled'
              ? 'Retry authorization'
              : 'Reauthenticate'}
          </Button>
        </>
      )}
    </SectionGroup>
  )
}

type RemoveConnectionGroupProps = {
  connectionId: string
  dependents: RegisteredProject[]
  configurationVersion: number
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
  const [confirming, setConfirming] = useState(false)
  const remove = async () => {
    const removed = await run({
      type: 'remove-connection',
      expectedConfigurationVersion: configurationVersion,
      connectionId,
    })
    if (removed) window.location.hash = connectionSettingsHash
  }

  return (
    <SectionGroup>
      <SectionGroupTitle>Remove connection</SectionGroupTitle>
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
    </SectionGroup>
  )
}
