import {
  mapRefSchema,
  type ProjectRef,
  projectRefSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import {
  type ApplicationState,
  automationEvidenceSchema,
  type Project,
  type ReadyApplicationState,
} from '@roadmap/contracts/state'
import type { AutomationEvidence, AutomationTarget } from './automation/model.ts'
import type { SourceProjectKey } from './observation/source.ts'
import type {
  ProjectRef as ConfiguredProjectRef,
  ProjectConfigurationIntent,
} from './projects/registry.ts'

/** Selects actual read evidence in tests whose claim is content, not lifecycle admission. */
export function readApplicationState(state: ApplicationState): ReadyApplicationState
export function readApplicationState(state: ApplicationState | null): ReadyApplicationState | null
export function readApplicationState(state: ApplicationState | null): ReadyApplicationState | null {
  if (state === null) return null
  if (state.phase === 'ready') return state
  if (
    (state.phase === 'stopping' || state.phase === 'stopped' || state.phase === 'failed') &&
    state.retained
  )
    return state.retained
  throw new Error(`No complete application read evidence exists in ${state.phase}.`)
}

export function fixtureProjectRef(project: SourceProjectKey | ConfiguredProjectRef): ProjectRef {
  return projectRefSchema.parse({
    integration: project.integration,
    projectId: 'id' in project ? project.id : project.projectId,
  })
}

export function fixtureProjectManagement(intent: ProjectConfigurationIntent) {
  return {
    ref: fixtureProjectRef(intent.ref),
    connectionId: intent.connectionId,
    management: {
      ...('locator' in intent ? { workspacePath: intent.workspace.path } : {}),
      ...(intent.displayName === undefined ? {} : { displayName: intent.displayName }),
    },
    ...('locator' in intent
      ? {}
      : { source: { integration: 'local', path: intent.workspace.path } }),
  }
}

export function fixtureTicketRef(target: AutomationTarget) {
  return ticketRefSchema.parse({
    map: { project: fixtureProjectRef(target.project), mapId: target.mapId },
    ticketId: target.ticketId,
  })
}

type FixtureMapRefInput = { project: SourceProjectKey | ConfiguredProjectRef; mapId: string }
type FixtureTicketRefInput = { map: FixtureMapRefInput; ticketId: string }

export function fixtureResourceRef(
  ref: SourceProjectKey | ConfiguredProjectRef | FixtureMapRefInput | FixtureTicketRefInput,
) {
  if ('map' in ref)
    return ticketRefSchema.parse({
      map: { project: fixtureProjectRef(ref.map.project), mapId: ref.map.mapId },
      ticketId: ref.ticketId,
    })
  if ('mapId' in ref)
    return mapRefSchema.parse({ project: fixtureProjectRef(ref.project), mapId: ref.mapId })
  return fixtureProjectRef(ref)
}

export function fixtureWorkspacePath(project: Project | undefined) {
  if (!project) return undefined
  return project.integration === 'local' ? project.source.path : project.management.workspacePath
}

export function fixtureAutomationEvidence(evidence: AutomationEvidence) {
  return automationEvidenceSchema.parse({
    target: fixtureTicketRef(evidence.target),
    classification: evidence.classification,
    ...(evidence.wayfinder === undefined ? {} : { wayfinder: evidence.wayfinder }),
  })
}
