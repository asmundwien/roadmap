import type { Connection, SafeError, SupportedIntegration } from '@roadmap/contracts'
import { Button } from '@roadmap/ui/button'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { useState } from 'react'
import { useRoadmap } from '@/store/roadmap-provider'
import { type ConnectionOperation, connectionAuthorization } from './connection-details'
import { AddConnectionPane, AuthorizationPane, EditConnectionPane } from './connection-panes'
import { ConnectionSetupSection, ConnectionStride } from './connection-sections'
import '@/views/shared/settings-flow.css'
import './connections.css'

type ConnectionPane =
  | { kind: 'add' }
  | { kind: 'edit'; connectionId: string }
  | { kind: 'authorization'; operationId: string }

export function ConnectionSettings() {
  const {
    connections,
    projects,
    supportedIntegrations,
    authorizationOperations,
    configuration,
    configurationVersion,
    command,
    execute,
  } = useRoadmap()
  const [pane, setPane] = useState<ConnectionPane | null>(null)
  const [notice, setNotice] = useState<{ connectionId: string | null; message: string } | null>(
    null,
  )
  const [operationError, setOperationError] = useState<{
    connectionId: string
    error: SafeError | string
  } | null>(null)
  const github = supportedIntegrations.find(
    (integration): integration is Extract<SupportedIntegration, { integration: 'github' }> =>
      integration.integration === 'github',
  )
  const blocked = command.inFlight || !configuration.valid
  const operation: ConnectionOperation = { execute }
  const looseOperations = authorizationOperations.filter(
    (authorization) =>
      !authorization.connectionId &&
      authorization.status !== 'granted' &&
      authorization.status !== 'cancelled',
  )

  return (
    <Page>
      <PageHeader className="connection-page-header">
        <div>
          <PageEyebrow>Settings</PageEyebrow>
          <PageTitle>Connections</PageTitle>
        </div>
        <Button
          variant="primary"
          type="button"
          disabled={blocked || !github}
          onClick={() => setPane({ kind: 'add' })}
        >
          <span aria-hidden="true">+</span>
          Add connection
        </Button>
      </PageHeader>
      {(!github ||
        !configuration.valid ||
        configuration.notices.length > 0 ||
        (notice && notice.connectionId === null) ||
        looseOperations.length > 0 ||
        connections.length === 0) && (
        <ConnectionSetupSection
          githubAvailable={Boolean(github)}
          configurationValid={configuration.valid}
          configurationNotices={configuration.notices}
          notice={notice?.connectionId === null ? notice.message : null}
          authorizations={looseOperations}
          hasConnections={connections.length > 0}
          onOpenAuthorization={(operationId) => setPane({ kind: 'authorization', operationId })}
        />
      )}
      {connections.map((connection) => {
        const dependents = projects.filter((project) => project.connectionId === connection.id)
        const authorization = connectionAuthorization(authorizationOperations, connection.id)
        return (
          <ConnectionStride
            key={connection.id}
            connection={connection}
            dependents={dependents}
            authorization={authorization}
            github={github}
            blocked={blocked}
            notice={notice?.connectionId === connection.id ? notice.message : null}
            onAuthorize={() => {
              if (authorization) {
                setPane({ kind: 'authorization', operationId: authorization.id })
              } else {
                void beginAuthorization({
                  connection,
                  configurationVersion,
                  operation,
                  setError: (error) =>
                    setOperationError(error ? { connectionId: connection.id, error } : null),
                  onStarted: (operationId) => setPane({ kind: 'authorization', operationId }),
                })
              }
            }}
            error={operationError?.connectionId === connection.id ? operationError.error : null}
            onEdit={() => setPane({ kind: 'edit', connectionId: connection.id })}
          />
        )
      })}

      {pane?.kind === 'add' && github && (
        <AddConnectionPane
          operation={operation}
          configurationVersion={configurationVersion}
          onClose={() => setPane(null)}
          onStarted={(operationId) => setPane({ kind: 'authorization', operationId })}
        />
      )}
      {pane?.kind === 'authorization' &&
        (() => {
          const authorization = authorizationOperations.find(
            (candidate) => candidate.id === pane.operationId,
          )
          if (!authorization) return null
          return (
            <AuthorizationPane
              authorization={authorization}
              operation={operation}
              configurationVersion={configurationVersion}
              onClose={() => setPane(null)}
              onFinished={(message) => {
                setPane(null)
                setNotice({ connectionId: authorization.connectionId ?? null, message })
              }}
            />
          )
        })()}
      {pane?.kind === 'edit' &&
        (() => {
          const connection = connections.find((candidate) => candidate.id === pane.connectionId)
          if (!connection) return null
          return (
            <EditConnectionPane
              connection={connection}
              dependents={projects.filter((project) => project.connectionId === connection.id)}
              operation={operation}
              configurationVersion={configurationVersion}
              onClose={() => setPane(null)}
              onChanged={(message, removed) => {
                setPane(null)
                setNotice({ connectionId: removed ? null : connection.id, message })
              }}
            />
          )
        })()}
    </Page>
  )
}

type BeginAuthorizationOptions = {
  connection: Connection
  configurationVersion: number
  operation: ConnectionOperation
  setError: (error: SafeError | string | null) => void
  onStarted: (operationId: string) => void
}

async function beginAuthorization({
  connection,
  configurationVersion,
  operation,
  setError,
  onStarted,
}: BeginAuthorizationOptions) {
  setError(null)
  try {
    const outcome = await operation.execute({
      type: 'begin-github-authorization',
      expectedConfigurationVersion: configurationVersion,
      connectionId: connection.id,
      name: connection.name,
    })
    if (!outcome.ok) {
      setError(outcome.error)
      return
    }
    if (outcome.result.type === 'authorization-started') onStarted(outcome.result.operationId)
  } catch {
    setError('The server did not confirm authorization. Wait for live state before retrying.')
  }
}
