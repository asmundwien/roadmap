import { useRoadmap } from '@/store/roadmap-provider'
import { OverviewConnectionStatus, OverviewHeader, ProjectOverviewSections } from './project-list'
import { presentProjects } from './project-presentation'
import '@/views/shared/views.css'

export function OverviewPage() {
  const { transport, projects, connections, configuration, capturedAt } = useRoadmap()
  const portfolio = presentProjects({ projects, connections, configuration })

  return (
    <main className="shell overview-shell">
      <OverviewHeader capturedAt={capturedAt} portfolio={portfolio} />
      <OverviewConnectionStatus capturedAt={capturedAt} transport={transport} />
      <ProjectOverviewSections portfolio={portfolio} />
    </main>
  )
}
