import type { Command, SafeError } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button, ButtonGroup } from '@roadmap/ui/button'
import { Link } from '@roadmap/ui/link'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { type FormEvent, useState } from 'react'
import { connectionSettingsHash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { ErrorText, observedLabel } from '@/views/shared/settings-shared'
import { AvailabilityLabel } from './availability-label'
import { AuthorizationGroup, RemoveConnectionGroup } from './management-sections'
import '@/views/shared/settings-flow.css'
import './page.css'

type ConnectionPageProps = { connectionId: string }

export function ConnectionPage({ connectionId }: ConnectionPageProps) {
  const {
    connections,
    capturedAt,
    projects,
    supportedIntegrations,
    authorizationOperations,
    configuration,
    configurationVersion,
    command,
    execute,
  } = useRoadmap()
  const [error, setError] = useState<SafeError | string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const connection = connections.find((candidate) => candidate.id === connectionId)

  if (!connection) {
    return (
      <Page>
        <PageHeader>
          <div>
            <PageEyebrow>Settings / Connections</PageEyebrow>
            <PageTitle>
              {capturedAt === null ? 'Loading connection' : 'Connection not found'}
            </PageTitle>
          </div>
        </PageHeader>
        <Link href={connectionSettingsHash}>Back to Connections</Link>
      </Page>
    )
  }

  const dependents = projects.filter((project) => project.connectionId === connectionId)
  const related = authorizationOperations.filter(
    (operation) => operation.connectionId === connectionId,
  )
  const authorization =
    related.findLast((operation) => operation.status === 'waiting') ?? related.at(-1)
  const github = supportedIntegrations.find((integration) => integration.integration === 'github')
  const blocked = busy || command.inFlight || !configuration.valid

  const run = async (next: Command, success?: string): Promise<boolean> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const outcome = await execute(next)
      if (!outcome.ok) {
        setError(outcome.error)
        return false
      }
      if (success) setNotice(success)
      return true
    } catch {
      setError('The server did not confirm the change. Wait for live state before retrying.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) {
      setError('Enter a Connection name.')
      return
    }
    void run(
      {
        type: 'rename-connection',
        expectedConfigurationVersion: configurationVersion,
        connectionId,
        name,
      },
      `${connection.name} renamed.`,
    )
  }

  return (
    <Page className="connection-detail">
      <PageHeader className="connection-detail-header">
        <div>
          <PageEyebrow>Settings / Connections</PageEyebrow>
          <PageTitle>{connection.name}</PageTitle>
        </div>
        {github && (
          <Link href={github.installationsUrl} external>
            Repository access
          </Link>
        )}
      </PageHeader>
      {!configuration.valid && (
        <Alert>
          <strong>Configuration needs repair.</strong>
          <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
        </Alert>
      )}
      {notice && <Alert variant="info">{notice}</Alert>}
      <ErrorText error={error} />
      <AvailabilityLabel connection={connection} />

      <Section>
        <SectionHeader>
          <SectionTitle>Connection details</SectionTitle>
        </SectionHeader>
        <SectionBody>
          <dl className="settings-facts">
            <dt>Integration</dt>
            <dd>
              <IntegrationBadge integration={connection.integration} />
            </dd>
            <dt>GitHub user</dt>
            <dd>
              {connection.githubIdentity ? `@${connection.githubIdentity.login}` : 'Not available'}
            </dd>
            <dt>Observed</dt>
            <dd>{observedLabel(connection.availability.observedAt)}</dd>
            <dt>Dependent Projects</dt>
            <dd>{dependents.length}</dd>
          </dl>
        </SectionBody>
      </Section>

      {!connection.builtIn && (
        <Section>
          <SectionHeader>
            <SectionTitle>Manage connection</SectionTitle>
          </SectionHeader>
          <SectionBody>
            <form className="settings-form" onSubmit={rename} key={connection.name}>
              <label>
                Connection name
                <input name="name" defaultValue={connection.name} />
              </label>
              <ButtonGroup className="settings-form-actions">
                <Button variant="primary" type="submit" disabled={blocked}>
                  Save name
                </Button>
              </ButtonGroup>
            </form>
            {connection.integration === 'github' && (
              <AuthorizationGroup
                connection={connection}
                authorization={authorization}
                configurationVersion={configurationVersion}
                blocked={blocked}
                run={run}
              />
            )}
            <RemoveConnectionGroup
              connectionId={connectionId}
              dependents={dependents}
              configurationVersion={configurationVersion}
              blocked={blocked}
              run={run}
            />
          </SectionBody>
        </Section>
      )}
    </Page>
  )
}
