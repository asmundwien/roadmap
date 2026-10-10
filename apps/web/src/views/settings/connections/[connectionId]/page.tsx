import type { ConnectionId } from '@roadmap/contracts/identity'
import { Alert } from '@roadmap/ui/alert'
import { Link as ExternalLink } from '@roadmap/ui/link'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Link } from '@/navigation'
import { resolveConnection } from '@/resources/results'
import { routePaths } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import {
  connectionAuthorizationFeedback,
  type WorkflowAttemptId,
  workflowFeedback,
} from '@/workflows/workflows'
import { DetailsSection } from './details-section'
import { ManageSection } from './manage-section'
import pageStyles from './page.module.css'

const cx = classNames.bind(pageStyles)

type ConnectionPageProps = { connectionId: ConnectionId }

export function ConnectionPage({ connectionId }: ConnectionPageProps) {
  return <ConnectionDetail key={connectionId} connectionId={connectionId} />
}

function ConnectionDetail({ connectionId }: ConnectionPageProps) {
  const { connection, configuration, workflows, rename, removal, authorizations } = useRoadmap(
    (roadmap) => ({
      connection: resolveConnection(roadmap, connectionId),
      configuration: roadmap.configuration,
      workflows: roadmap.workflows,
      rename: workflowFeedback(roadmap.workflowState, 'rename-connection', {
        kind: 'connection',
        connectionId,
      }),
      removal: workflowFeedback(roadmap.workflowState, 'remove-connection', {
        kind: 'connection',
        connectionId,
      }),
      authorizations: connectionAuthorizationFeedback(roadmap.workflowState, connectionId),
    }),
  )
  const navigate = useNavigate()
  const active = useRef(true)
  const navigationRequest = useRef<symbol | null>(null)
  const [navigationAttempt, setNavigationAttempt] = useState<WorkflowAttemptId | null>(null)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      navigationRequest.current = null
    }
  }, [])
  const remove = async () => {
    const request = Symbol('removal navigation')
    navigationRequest.current = request
    const attempt = await workflows.removeConnection({ connectionId })
    if (!active.current || navigationRequest.current !== request) return
    setNavigationAttempt(attempt.id)
  }
  useEffect(() => {
    const current = removal.current
    if (
      !active.current ||
      !navigationAttempt ||
      current?.id !== navigationAttempt ||
      current.kind !== 'acknowledged' ||
      !current.destination
    )
      return
    navigate(current.destination, { replace: true })
  }, [navigationAttempt, removal.current, navigate])
  const feedback = (
    <>
      {connection.kind === 'missing' && (
        <WorkflowFeedback feedback={rename} workflows={workflows} />
      )}
      <WorkflowFeedback feedback={removal} workflows={workflows} />
      {authorizations.map((authorization) => (
        <WorkflowFeedback
          key={authorization.current?.id ?? 'reauthorize'}
          feedback={authorization}
          workflows={workflows}
        />
      ))}
    </>
  )

  if (connection.kind === 'missing') {
    return (
      <Page>
        <PageHeader>
          <div>
            <PageEyebrow>Settings / Connections</PageEyebrow>
            <PageTitle>Connection not found</PageTitle>
          </div>
        </PageHeader>
        {feedback}
        <Link href={routePaths.connections}>Back to Connections</Link>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader className={cx('connection-detail-header')}>
        <div>
          <PageEyebrow>Settings / Connections</PageEyebrow>
          <PageTitle>{connection.name}</PageTitle>
        </div>
        {connection.registration.installations.kind === 'link' && (
          <ExternalLink href={connection.registration.installations.href} external>
            Repository access
          </ExternalLink>
        )}
      </PageHeader>
      {feedback}
      {!configuration.valid && (
        <Alert>
          <strong>Configuration needs repair.</strong>
          <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
        </Alert>
      )}
      {connection.health.status !== 'available' && (
        <Alert>
          <strong>{connection.health.label}</strong>
          <span>{connection.health.cause}</span>
        </Alert>
      )}
      <DetailsSection connection={connection} />
      <ManageSection key={connection.id} connection={connection} onRemove={remove} />
    </Page>
  )
}
