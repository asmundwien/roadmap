import type { ProjectKey } from '@roadmap/contracts'
import type { Route } from '../../router.ts'
import { useRoadmap } from '../../store/roadmap-provider.tsx'
import { MissingProjectSection, ProjectMapSections } from './project-screen.tsx'
import '../shared/views.css'

type MapPageProps = { route: Extract<Route, { screen: 'project' }> }

export function MapPage({ route }: MapPageProps) {
  const {
    transport,
    projects,
    roadmapProjects,
    capturedAt,
    automation,
    configurationVersion,
    command,
    execute,
  } = useRoadmap()
  const registration = projects.find((candidate) => sameProject(candidate.key, route.project))
  const source = roadmapProjects.find((candidate) => sameProject(candidate.key, route.project))
  const project = registration
    ? {
        ...registration,
        ...(source?.sourcePath === undefined ? {} : { sourcePath: source.sourcePath }),
      }
    : source

  if (!project) {
    return (
      <MissingProjectSection
        capturedAt={capturedAt}
        disconnected={transport === 'disconnected'}
        projectId={route.project.id}
      />
    )
  }

  return (
    <ProjectMapSections
      key={`${project.key.integration}:${project.key.id}`}
      project={project}
      selected={route.selected}
      selection={route.selection}
      disconnected={transport === 'disconnected'}
      unavailable={
        registration?.availability.status === 'unavailable' ? registration.availability.cause : null
      }
      automation={{
        state: automation,
        configurationVersion,
        commandInFlight: command.inFlight,
        execute,
      }}
    />
  )
}

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
