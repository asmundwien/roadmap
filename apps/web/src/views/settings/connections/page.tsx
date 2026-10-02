import type { SupportedIntegration } from '@roadmap/contracts'
import { Button } from '@roadmap/ui/button'
import { Icon, icon } from '@roadmap/ui/icon'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { useState } from 'react'
import { useRoadmap } from '@/store/roadmap-provider'
import { AutomationSection } from './automation-section'
import type { ConnectionOperation } from './connection-details'
import { AddConnectionPane, AuthorizationPane } from './connection-panes'
import { ConnectionSetupSection, ConnectionStride } from './connection-sections'
import pageStyles from './connections.module.css'

type ConnectionPane = { kind: 'add' } | { kind: 'authorization'; operationId: string }

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
  const [notice, setNotice] = useState<string | null>(null)
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
      <PageHeader className={pageStyles['connection-page-header']}>
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
          <Icon icon={icon.plus} />
          Add connection
        </Button>
      </PageHeader>
      <AutomationSection />
      {(!github ||
        !configuration.valid ||
        configuration.notices.length > 0 ||
        notice ||
        looseOperations.length > 0 ||
        connections.length === 0) && (
        <ConnectionSetupSection
          githubAvailable={Boolean(github)}
          configurationValid={configuration.valid}
          configurationNotices={configuration.notices}
          notice={notice}
          authorizations={looseOperations}
          hasConnections={connections.length > 0}
          onOpenAuthorization={(operationId) => setPane({ kind: 'authorization', operationId })}
        />
      )}
      {connections.map((connection) => (
        <ConnectionStride
          key={connection.id}
          connection={connection}
          dependents={projects.filter((project) => project.connectionId === connection.id)}
        />
      ))}

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
                setNotice(message)
              }}
            />
          )
        })()}
    </Page>
  )
}
