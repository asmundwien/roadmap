import type {
  AuthorizationOperation,
  Command,
  Connection,
  RegisteredProject,
} from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button, ButtonGroup } from '@roadmap/ui/button'
import { Link } from '@roadmap/ui/link'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { useState } from 'react'
import { connectionSettingsHash } from '@/router'

type RunCommand = (command: Command, success?: string) => Promise<boolean>

type AuthorizationSectionProps = {
  connection: Connection
  authorization: AuthorizationOperation | undefined
  configurationVersion: number
  blocked: boolean
  run: RunCommand
}

export function AuthorizationSection({
  connection,
  authorization,
  configurationVersion,
  blocked,
  run,
}: AuthorizationSectionProps) {
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
    <Section>
      <SectionHeader>
        <SectionTitle>GitHub authorization</SectionTitle>
      </SectionHeader>
      <SectionBody>
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
              <ButtonGroup>
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
              </ButtonGroup>
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
      </SectionBody>
    </Section>
  )
}

type RemoveConnectionSectionProps = {
  connectionId: string
  dependents: RegisteredProject[]
  configurationVersion: number
  blocked: boolean
  run: RunCommand
}

export function RemoveConnectionSection({
  connectionId,
  dependents,
  configurationVersion,
  blocked,
  run,
}: RemoveConnectionSectionProps) {
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
    <Section>
      <SectionHeader>
        <SectionTitle>Remove Connection</SectionTitle>
      </SectionHeader>
      <SectionBody>
        {dependents.length > 0 ? (
          <>
            <p>
              Remove every dependent Project registration first. Reassignment and cascade removal
              are unavailable.
            </p>
            <Button variant="danger" type="button" disabled>
              Remove connection
            </Button>
          </>
        ) : confirming ? (
          <>
            <p>External GitHub authorization and repositories remain unchanged.</p>
            <ButtonGroup>
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
            </ButtonGroup>
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
      </SectionBody>
    </Section>
  )
}
