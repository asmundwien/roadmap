import type { ProjectKey } from '@roadmap/contracts'
import type { Route } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { MissingProjectSection, ProjectMapSections } from './project-screen'
import './map.css'
import './views.css'
import './destination-mark.css'

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
      <div className="project-map-screen">
        <MissingProjectSection
          capturedAt={capturedAt}
          disconnected={transport === 'disconnected'}
          projectId={route.project.id}
        />
      </div>
    )
  }

  return (
    <div className="project-map-screen">
      <ProjectMapSections
        key={`${project.key.integration}:${project.key.id}`}
        project={project}
        selected={route.selected}
        selection={route.selection}
        disconnected={transport === 'disconnected'}
        unavailable={
          registration?.availability.status === 'unavailable'
            ? registration.availability.cause
            : null
        }
        automation={{
          state: automation,
          configurationVersion,
          commandInFlight: command.inFlight,
          execute,
        }}
      />
    </div>
  )
}

function sameProject(a: ProjectKey, b: ProjectKey): boolean {
  return a.integration === b.integration && a.id === b.id
}
