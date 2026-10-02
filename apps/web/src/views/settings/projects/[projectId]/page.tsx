import type { ProjectKey } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Link } from '@roadmap/ui/link'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { connectionSettingsHash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { sameProject } from '@/views/shared/settings-shared'
import { AutomationSection } from './automation-section'
import { DetailsSection } from './details-section'
import { ManageSection } from './manage-section'
import '@/views/shared/settings-flow.css'
import './page.css'

type ProjectRegistrationPageProps = { projectKey: ProjectKey }

export function ProjectRegistrationPage({ projectKey }: ProjectRegistrationPageProps) {
  const { projects, connections, capturedAt, configuration } = useRoadmap()
  const project = projects.find((candidate) => sameProject(candidate.key, projectKey))

  if (!project) {
    return (
      <Page>
        <PageHeader>
          <div>
            <PageEyebrow>Settings / Projects</PageEyebrow>
            <PageTitle>{capturedAt === null ? 'Loading project' : 'Project not found'}</PageTitle>
          </div>
        </PageHeader>
        <Link href={connectionSettingsHash}>Back to Connections</Link>
      </Page>
    )
  }

  const connection = connections.find((candidate) => candidate.id === project.connectionId)

  return (
    <Page className="project-registration">
      <PageHeader className="project-registration-header">
        <div>
          <PageEyebrow>Settings / Projects</PageEyebrow>
          <PageTitle>{project.name}</PageTitle>
        </div>
      </PageHeader>
      {!configuration.valid && (
        <Alert>
          <strong>Configuration needs repair.</strong>
          <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
        </Alert>
      )}
      {project.availability.status === 'unavailable' && (
        <Alert>
          <strong>Project unavailable.</strong>
          <span>{project.availability.cause}</span>
        </Alert>
      )}
      {connection && connection.availability.status !== 'available' && (
        <Alert>
          <strong>{connection.name} is not available.</strong>
          <span>{connection.availability.cause}</span>
        </Alert>
      )}
      {project.warnings.map((warning) => (
        <Alert key={warning}>{warning}</Alert>
      ))}
      {project.openMaps.length + project.closedMaps.length === 0 && (
        <Alert variant="info">
          <strong>No Wayfinder maps yet.</strong>
          <span>The Project remains registered and will appear when its first map is created.</span>
        </Alert>
      )}
      <DetailsSection
        key={`details:${project.key.integration}:${project.key.id}`}
        project={project}
        connection={connection}
      />
      <AutomationSection
        key={`automation:${project.key.integration}:${project.key.id}`}
        project={project}
      />
      <ManageSection
        key={`manage:${project.key.integration}:${project.key.id}`}
        project={project}
        connectionExists={connection !== undefined}
      />
    </Page>
  )
}
