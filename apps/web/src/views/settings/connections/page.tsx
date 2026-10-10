import type { AuthorizationOperationId } from '@roadmap/contracts/identity'
import { Button } from '@roadmap/ui/button'
import { Icon, icon } from '@roadmap/ui/icon'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import { useRef, useState } from 'react'
import { presentConnections, resolveAuthorization } from '@/resources/results'
import { useRoadmap } from '@/store/roadmap-provider'
import { AutomationSection } from './automation-section'
import {
  type AuthorizationResultFeedback,
  authorizationResultPending,
  type ConnectionOperation,
  consumeAuthorizationFeedback,
} from './connection-details'
import { AddConnectionPane, AuthorizationPane } from './connection-panes'
import { ConnectionSetupSection } from './connection-sections'
import { ConnectionStride } from './connection-stride'
import pageStyles from './page.module.css'

const cx = classNames.bind(pageStyles)

type ConnectionPane =
  | { kind: 'add' }
  | { kind: 'authorization'; operationId: AuthorizationOperationId }

export function ConnectionSettings() {
  const {
    portfolio,
    authorizationOperations,
    authorizationPresentations,
    configuration,
    configurationVersion,
    command,
    execute,
  } = useRoadmap((roadmap) => ({
    portfolio: presentConnections(roadmap),
    authorizationOperations: roadmap.authorizationOperations,
    authorizationPresentations: roadmap.authorizationOperations.map((authorization) =>
      resolveAuthorization(roadmap, authorization),
    ),
    configuration: {
      valid: roadmap.configuration.valid,
      notices: roadmap.configuration.notices,
    },
    configurationVersion: roadmap.configurationVersion,
    command: { inFlight: roadmap.command.inFlight },
    execute: roadmap.execute,
  }))
  const [pane, setPane] = useState<ConnectionPane | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [authorizationFeedback, setAuthorizationFeedback] = useState<AuthorizationResultFeedback[]>(
    [],
  )
  const currentAuthorizations = useRef(authorizationOperations)
  currentAuthorizations.current = authorizationOperations
  const reconciledFeedback = authorizationFeedback.map((feedback) =>
    consumeAuthorizationFeedback(
      authorizationOperations.find((candidate) => candidate.id === feedback.result.operationId),
      feedback,
    ),
  )
  if (reconciledFeedback.some((feedback, index) => feedback !== authorizationFeedback[index])) {
    setAuthorizationFeedback(reconciledFeedback)
  }
  const rememberResult = (feedback: AuthorizationResultFeedback) => {
    setAuthorizationFeedback((current) => [
      ...current.filter((item) => item.result.operationId !== feedback.result.operationId),
      consumeAuthorizationFeedback(
        currentAuthorizations.current.find(
          (candidate) => candidate.id === feedback.result.operationId,
        ),
        feedback,
      ),
    ])
  }
  const unpublishedFeedback = reconciledFeedback.filter((feedback) =>
    authorizationResultPending(
      authorizationOperations.find((candidate) => candidate.id === feedback.result.operationId),
      feedback,
    ),
  )
  const { connections, githubSetup: github, looseAuthorizations: looseOperations } = portfolio
  const blocked = command.inFlight || !configuration.valid
  const operation: ConnectionOperation = { execute }

  return (
    <Page>
      <PageHeader className={cx('connection-page-header')}>
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
        unpublishedFeedback.length > 0 ||
        connections.length === 0) && (
        <ConnectionSetupSection
          githubAvailable={Boolean(github)}
          configurationValid={configuration.valid}
          configurationNotices={configuration.notices}
          notice={notice}
          authorizations={looseOperations}
          feedback={unpublishedFeedback}
          hasConnections={connections.length > 0}
          onOpenAuthorization={(operationId) => setPane({ kind: 'authorization', operationId })}
        />
      )}
      {connections.map((connection) => (
        <ConnectionStride key={connection.id} connection={connection} />
      ))}

      {pane?.kind === 'add' && github && (
        <AddConnectionPane
          operation={operation}
          configurationVersion={configurationVersion}
          onClose={() => setPane(null)}
          onResult={(result) => {
            rememberResult({ result, previous: undefined, consumed: false })
            setPane({ kind: 'authorization', operationId: result.operationId })
          }}
        />
      )}
      {pane?.kind === 'authorization' &&
        (() => {
          const authorization = authorizationOperations.find(
            (candidate) => candidate.id === pane.operationId,
          )
          return (
            <AuthorizationPane
              key={pane.operationId}
              authorization={authorization}
              presentation={
                authorizationPresentations.find((candidate) => candidate.id === pane.operationId) ??
                null
              }
              feedback={
                reconciledFeedback.find((item) => item.result.operationId === pane.operationId) ??
                null
              }
              operation={operation}
              configurationVersion={configurationVersion}
              onClose={() => setPane(null)}
              onResult={rememberResult}
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
