import type { ConnectionId, MapRef, ProjectRef, TicketRef } from '@roadmap/contracts/identity'
import type { AuthorizationOperation } from '@roadmap/contracts/state'
import {
  type ConsumerRead,
  presentAutomation,
  presentProjects,
  resolveAuthorization,
  resolveConnection,
  resolveProject,
  resolveSelection,
} from '@/resources/results'

declare const read: ConsumerRead
declare const project: ProjectRef
declare const map: MapRef
declare const ticket: TicketRef
declare const connection: ConnectionId
declare const authorization: AuthorizationOperation

export const projectResult = resolveProject(read, project)
export const connectionResult = resolveConnection(read, connection)
export const selectionResult = resolveSelection(read, { project, map, ticket })
export const defaultSelection = resolveSelection(read, { project, map: null, ticket: null })
export const projectSummaries = presentProjects(read)
export const automation = presentAutomation(read)
export const authorizationResult = resolveAuthorization(read, authorization)
