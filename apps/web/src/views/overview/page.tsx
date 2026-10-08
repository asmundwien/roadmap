import { Page } from '@roadmap/ui/page'
import { useRoadmap } from '@/store/roadmap-provider'
import { OverviewHeader, ProjectOverviewSections } from './project-list'
import { presentProjects } from './project-presentation'

export function OverviewPage() {
  const { projects, connections, configuration, capturedAt } = useRoadmap()
  const portfolio = presentProjects({ projects, connections, configuration })

  return (
    <Page>
      <OverviewHeader capturedAt={capturedAt} portfolio={portfolio} />
      <ProjectOverviewSections portfolio={portfolio} />
    </Page>
  )
}
