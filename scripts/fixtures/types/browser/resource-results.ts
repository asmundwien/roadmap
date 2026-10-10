import type { ConnectionId, MapRef, ProjectRef, TicketRef } from '@roadmap/contracts/identity'
import type { AuthorizationOperation } from '@roadmap/contracts/state'
import {
  type ConsumerRead,
  type ProjectResult,
  presentAutomation,
  presentProjects,
  resolveAuthorization,
  resolveConnection,
  resolveProject,
  resolveSelection,
  type SessionResult,
  type SourceDestination,
} from '@/resources/results'
import { useRoadmap } from '@/store/roadmap-provider'

declare const read: ConsumerRead
declare const project: ProjectRef
declare const map: MapRef
declare const ticket: TicketRef
declare const connection: ConnectionId
declare const admittedSession: Extract<
  SessionResult,
  { status: 'running' | 'launching' | 'finished' | 'launch-failed' }
>
declare const authorization: AuthorizationOperation

export const projectResult: ProjectResult = resolveProject(read, project)
export const connectionResult = resolveConnection(read, connection)
export const selectionResult = resolveSelection(read, { project, map, ticket })
export const defaultSelection = resolveSelection(read, { project, map: null, ticket: null })
export const projectSummaries = presentProjects(read)
export const automation = presentAutomation(read)
export const authorizationResult = resolveAuthorization(read, authorization)
export const queuedWithoutAdmission: SessionResult = {
  status: 'queued',
  admission: { kind: 'none', label: 'No launch admission' },
  facts: [],
}
export const linkDestination: SourceDestination = {
  kind: 'link',
  href: 'https://example.test/source',
}
export const fileDestination: SourceDestination = { kind: 'file', path: '/workspace/map.md' }
export const absentDestination: SourceDestination = { kind: 'absent' }
export const knownProjectName =
  projectResult.kind === 'known' ? projectResult.name : projectResult.message

export function selectedResourceResults() {
  const selected = useRoadmap((roadmap) => ({
    project: resolveProject(roadmap, project),
    connection: resolveConnection(roadmap, connection),
    selection: resolveSelection(roadmap, { project, map, ticket }),
    automation: presentAutomation(roadmap),
    workflows: roadmap.workflows,
  }))
  const result: ProjectResult = selected.project
  const rename = selected.workflows.renameProject({ project, name: 'Selected project' })
  return {
    result,
    rename,
    connection: selected.connection,
    selection: selected.selection,
    automation: selected.automation,
  }
}

// Invalid constructions.
export const invalidUnscopedSelection = resolveSelection(read, {
  project,
  map: 'map',
  ticket: null,
})
export const invalidMapKindSelection = resolveSelection(read, {
  project,
  map: ticket,
  ticket: null,
})
export const invalidTicketKindSelection = resolveSelection(read, { project, map, ticket: map })
export const invalidKnownProjectPayload: ProjectResult = { kind: 'known', ref: project }
export const invalidQueuedAdmission: SessionResult = {
  status: 'queued',
  admission: admittedSession.admission,
  facts: [],
}
export const invalidLinkDestination: SourceDestination = { kind: 'link' }
export const invalidFileDestination: SourceDestination = { kind: 'file' }
