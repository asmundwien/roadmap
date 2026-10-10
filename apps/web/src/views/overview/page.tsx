import { Page } from '@roadmap/ui/page'
import { presentProjects } from '@/resources/results'
import { useRoadmap } from '@/store/roadmap-provider'
import { OverviewHeader, ProjectOverviewSections } from './project-list'

export function OverviewPage() {
  const { portfolio, capturedAt } = useRoadmap((read) => ({
    portfolio: presentProjects(read),
    capturedAt: read.capturedAt,
  }))

  return (
    <Page>
      <OverviewHeader capturedAt={capturedAt} portfolio={portfolio} />
      <ProjectOverviewSections portfolio={portfolio} automation={portfolio.automation} />
    </Page>
  )
}
