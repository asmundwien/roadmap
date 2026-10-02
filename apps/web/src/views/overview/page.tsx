import { Page } from '@roadmap/ui/page'
import { useRoadmap } from '@/store/roadmap-provider'
import { OverviewConnectionStatus, OverviewHeader, ProjectOverviewSections } from './project-list'
import { presentProjects } from './project-presentation'

export function OverviewPage() {
  const { transport, projects, connections, configuration, capturedAt } = useRoadmap()
  const portfolio = presentProjects({ projects, connections, configuration })

  return (
    <Page>
      <OverviewHeader capturedAt={capturedAt} portfolio={portfolio} />
      <OverviewConnectionStatus capturedAt={capturedAt} transport={transport} />
      <ProjectOverviewSections portfolio={portfolio} />
    </Page>
  )
}
