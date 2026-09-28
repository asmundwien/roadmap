import type { ProjectKey } from '@roadmap/contracts'
import { Link } from '@roadmap/ui/link'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { connectionSettingsHash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { sameProject } from '@/views/shared/settings-shared'

type ProjectRegistrationPageProps = { projectKey: ProjectKey }

export function ProjectRegistrationPage({ projectKey }: ProjectRegistrationPageProps) {
  const { projects, capturedAt } = useRoadmap()
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

  return (
    <Page>
      <PageHeader>
        <div>
          <PageEyebrow>Settings / Projects</PageEyebrow>
          <PageTitle>{project.name}</PageTitle>
        </div>
      </PageHeader>
    </Page>
  )
}
