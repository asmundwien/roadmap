import { Alert } from '@roadmap/ui/alert'
import { Link as ExternalLink } from '@roadmap/ui/link'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import { Link } from '@/navigation'
import { routePaths } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { AvailabilityLabel } from './availability-label'
import { DetailsSection } from './details-section'
import { ManageSection } from './manage-section'
import pageStyles from './page.module.css'

const cx = classNames.bind(pageStyles)

type ConnectionPageProps = { connectionId: string }

export function ConnectionPage({ connectionId }: ConnectionPageProps) {
  const { connections, capturedAt, supportedIntegrations, configuration } = useRoadmap()
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
        <Link href={routePaths.connections}>Back to Connections</Link>
      </Page>
    )
  }

  const github = supportedIntegrations.find((integration) => integration.integration === 'github')

  return (
    <Page>
      <PageHeader className={cx('connection-detail-header')}>
        <div>
          <PageEyebrow>Settings / Connections</PageEyebrow>
          <PageTitle>{connection.name}</PageTitle>
        </div>
        {github && (
          <ExternalLink href={github.installationsUrl} external>
            Repository access
          </ExternalLink>
        )}
      </PageHeader>
      {!configuration.valid && (
        <Alert>
          <strong>Configuration needs repair.</strong>
          <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
        </Alert>
      )}
      <AvailabilityLabel connection={connection} />
      <DetailsSection connection={connection} />
      <ManageSection connection={connection} />
    </Page>
  )
}
