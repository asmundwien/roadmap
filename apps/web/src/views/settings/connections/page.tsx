import type { AuthorizationOperationId } from '@roadmap/contracts/identity'
import { Button } from '@roadmap/ui/button'
import { Icon, icon } from '@roadmap/ui/icon'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import { useState } from 'react'
import { presentConnections, resolveAuthorization } from '@/resources/results'
import { useRoadmap } from '@/store/roadmap-provider'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import {
  authorizationFeedback,
  unpublishedAuthorizationFeedback,
  workflowFeedback,
} from '@/workflows/workflows'
import { AutomationSection } from './automation-section'
import { AddConnectionPane, AuthorizationPane } from './connection-panes'
import { ConnectionSetupSection } from './connection-sections'
import { ConnectionStride } from './connection-stride'
import pageStyles from './page.module.css'

const cx = classNames.bind(pageStyles)

type ConnectionPane =
  | { kind: 'add' }
  | { kind: 'authorization'; operationId: AuthorizationOperationId }

export function ConnectionSettings() {
  const [pane, setPane] = useState<ConnectionPane | null>(null)
  const {
    portfolio,
    authorization,
    presentation,
    phaseFeedback,
    configuration,
    workflows,
    beginFeedback,
    authorizationNotices,
    unpublishedFeedback,
  } = useRoadmap((roadmap) => {
    const operationIds = [
      ...new Set(
        roadmap.workflowState.attempts.flatMap((attempt) =>
          attempt.subject.kind === 'authorization' ? [attempt.subject.operationId] : [],
        ),
      ),
    ]
    const currentAuthorization =
      pane?.kind === 'authorization'
        ? roadmap.authorizationOperations.find((candidate) => candidate.id === pane.operationId)
        : undefined
    return {
      portfolio: presentConnections(roadmap),
      authorization: currentAuthorization,
      presentation: currentAuthorization
        ? resolveAuthorization(roadmap, currentAuthorization)
        : null,
      phaseFeedback:
        pane?.kind === 'authorization'
          ? authorizationFeedback(roadmap.workflowState, pane.operationId)
          : null,
      configuration: {
        valid: roadmap.configuration.valid,
        notices: roadmap.configuration.notices,
      },
      workflows: roadmap.workflows,
      beginFeedback: workflowFeedback(roadmap.workflowState, 'begin-github-authorization', {
        kind: 'none',
      }),
      authorizationNotices: operationIds.map((operationId) => ({
        operationId,
        retry: workflowFeedback(roadmap.workflowState, 'retry-github-authorization', {
          kind: 'authorization',
          operationId,
        }),
        cancel: workflowFeedback(roadmap.workflowState, 'cancel-github-authorization', {
          kind: 'authorization',
          operationId,
        }),
      })),
      unpublishedFeedback: unpublishedAuthorizationFeedback(roadmap.workflowState),
    }
  })
  const { connections, githubSetup: github, looseAuthorizations: looseOperations } = portfolio
  const paneBeginFeedback =
    pane?.kind === 'authorization' &&
    beginFeedback.current?.kind === 'acknowledged' &&
    beginFeedback.current.operation === 'begin-github-authorization' &&
    beginFeedback.current.result.operationId === pane.operationId
      ? beginFeedback
      : null

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
          disabled={beginFeedback.blocked || beginFeedback.pending}
          onClick={() => setPane({ kind: 'add' })}
        >
          <Icon icon={icon.plus} />
          Add connection
        </Button>
      </PageHeader>
      <AutomationSection />
      {pane?.kind !== 'add' && !paneBeginFeedback && (
        <WorkflowFeedback feedback={beginFeedback} workflows={workflows} />
      )}
      {authorizationNotices.map(({ operationId, retry, cancel }) =>
        pane?.kind === 'authorization' && pane.operationId === operationId ? null : (
          <div key={operationId}>
            <WorkflowFeedback feedback={retry} workflows={workflows} />
            <WorkflowFeedback feedback={cancel} workflows={workflows} />
          </div>
        ),
      )}
      {(!github ||
        !configuration.valid ||
        configuration.notices.length > 0 ||
        looseOperations.length > 0 ||
        unpublishedFeedback.length > 0 ||
        connections.length === 0) && (
        <ConnectionSetupSection
          githubAvailable={Boolean(github)}
          configurationValid={configuration.valid}
          configurationNotices={configuration.notices}
          authorizations={looseOperations}
          feedback={unpublishedFeedback}
          hasConnections={connections.length > 0}
          onOpenAuthorization={(operationId) => setPane({ kind: 'authorization', operationId })}
        />
      )}
      {connections.map((connection) => (
        <ConnectionStride key={connection.id} connection={connection} />
      ))}

      {pane?.kind === 'add' && (
        <AddConnectionPane
          onClose={() => setPane(null)}
          onResult={(result) => {
            setPane({ kind: 'authorization', operationId: result.operationId })
          }}
        />
      )}
      {pane?.kind === 'authorization' && (
        <AuthorizationPane
          key={pane.operationId}
          operationId={pane.operationId}
          authorization={authorization}
          presentation={presentation}
          feedback={phaseFeedback}
          beginFeedback={paneBeginFeedback}
          onClose={() => setPane(null)}
        />
      )}
    </Page>
  )
}
