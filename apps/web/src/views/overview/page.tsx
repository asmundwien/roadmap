import { useRoadmap } from '../../store/roadmap-provider.tsx'
import {
  OverviewConnectionStatus,
  OverviewHeader,
  ProjectOverviewSections,
} from './project-list.tsx'
import { presentProjects } from './project-presentation.ts'
import '../shared/views.css'

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
