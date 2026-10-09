import type { ProjectRef } from '@roadmap/contracts/identity'
import { Alert } from '@roadmap/ui/alert'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import { Link } from '@/navigation'
import { routePaths } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { resourceMessage, resourceObservation } from '@/views/shared/resource-results'
import { sameProject } from '@/views/shared/settings-shared'
import { AutomationSection } from './automation-section'
import { DetailsSection } from './details-section'
import { ManageSection } from './manage-section'
import pageStyles from './page.module.css'

const cx = classNames.bind(pageStyles)

type ProjectSettingsPageProps = { projectRef: ProjectRef }

export function ProjectSettingsPage({ projectRef }: ProjectSettingsPageProps) {
  const { projects, connections, configuration } = useRoadmap()
  const project = projects.find((candidate) => sameProject(candidate.ref, projectRef))

  if (!project) {
    return (
      <Page>
        <PageHeader>
          <div>
            <PageEyebrow>Settings / Projects</PageEyebrow>
            <PageTitle>Project not found</PageTitle>
          </div>
        </PageHeader>
        <Link href={routePaths.connections}>Back to Connections</Link>
      </Page>
    )
  }

  const connection = connections.find((candidate) => candidate.id === project.connectionId)

  return (
    <Page>
      <PageHeader className={cx('project-registration-header')}>
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
      <Alert variant={project.resource.kind === 'current-readable' ? 'info' : undefined}>
        <strong>Project source evidence.</strong>
        <span>{resourceMessage(project.resource)}</span>
      </Alert>
      {connection && connection.availability.status !== 'available' && (
        <Alert>
          <strong>{connection.name} is not available.</strong>
          <span>{connection.availability.cause}</span>
        </Alert>
      )}
      {[
        ...(resourceObservation(project.resource)?.value.warnings ?? []),
        ...project.managementWarnings,
      ].map((warning) => (
        <Alert key={warning}>{warning}</Alert>
      ))}
      {project.activeMap.kind === 'uncertain' ? (
        <Alert>
          <strong>Active map is uncertain.</strong>
          <span>{project.activeMap.cause}</span>
        </Alert>
      ) : (
        project.mapsMembership.kind === 'current-complete' &&
        project.mapsMembership.observation.value.members.length === 0 && (
          <Alert variant="info">
            <strong>No current Wayfinder maps.</strong>
            <span>
              Complete current membership contains no maps. Historical resources remain inspectable.
            </span>
          </Alert>
        )
      )}
      <DetailsSection
        key={`details:${project.ref.integration}:${project.ref.projectId}`}
        project={project}
        connection={connection}
      />
      <AutomationSection
        key={`automation:${project.ref.integration}:${project.ref.projectId}`}
        project={project}
      />
      <ManageSection
        key={`manage:${project.ref.integration}:${project.ref.projectId}`}
        project={project}
        connectionExists={connection !== undefined}
      />
    </Page>
  )
}
