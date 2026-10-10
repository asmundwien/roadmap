import type { ConnectionId } from '@roadmap/contracts/identity'
import type { CommandResult, SafeError } from '@roadmap/contracts/operations'
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
import { ErrorText } from '@/views/shared/settings-shared'
import { DetailsSection } from './details-section'
import { ManageSection } from './manage-section'
import pageStyles from './page.module.css'

const cx = classNames.bind(pageStyles)

type ConnectionPageProps = { connectionId: ConnectionId }

type RemovalFeedback =
  | { kind: 'pending' }
  | { kind: 'unconfirmed'; result: Extract<CommandResult, { type: 'remove-connection' }> }
  | { kind: 'error'; error: SafeError | string }

export function ConnectionPage({ connectionId }: ConnectionPageProps) {
  return <ConnectionDetail key={connectionId} connectionId={connectionId} />
}

function ConnectionDetail({ connectionId }: ConnectionPageProps) {
  const { connection, configuration, configurationVersion, execute } = useRoadmap((roadmap) => ({
    connection: resolveConnection(roadmap, connectionId),
    configuration: roadmap.configuration,
    configurationVersion: roadmap.configurationVersion,
    execute: roadmap.execute,
  }))
  const navigate = useNavigate()
  const [removal, setRemoval] = useState<RemovalFeedback | null>(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const remove = async () => {
    setRemoval({ kind: 'pending' })
    try {
      const outcome = await execute({
        type: 'remove-connection',
        expectedConfigurationVersion: configurationVersion,
        connectionId,
      })
      if (!active.current) return
      if (!outcome.ok) {
        setRemoval({ kind: 'error', error: outcome.error })
      } else if (outcome.result.commit === 'committed') {
        setRemoval(null)
        navigate(routePaths.connections, { replace: true })
      } else {
        setRemoval({ kind: 'unconfirmed', result: outcome.result })
      }
    } catch {
      if (active.current)
        setRemoval({
          kind: 'error',
          error: `Connection ${connectionId} removal may have completed. Check the relevant configuration before retrying.`,
        })
    }
  }
  const feedback =
    removal?.kind === 'pending' ? (
      <Alert variant="info">
        {`Waiting for the removal result for Connection ${connectionId}. Current configuration does not confirm this operation's durability.`}
      </Alert>
    ) : removal?.kind === 'unconfirmed' ? (
      <Alert variant="info">
        {`Connection ${removal.result.connectionId} removal committed at configuration version ${removal.result.configurationVersion}, but durability is unconfirmed. External GitHub authorization and repositories remain unchanged.`}
      </Alert>
    ) : removal?.kind === 'error' ? (
      <ErrorText error={removal.error} />
    ) : null

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
      <ManageSection
        key={connection.id}
        connection={connection}
        removing={removal?.kind === 'pending'}
        onRemove={remove}
      />
    </Page>
  )
}
