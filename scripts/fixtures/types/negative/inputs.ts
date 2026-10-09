import * as identity from '@roadmap/contracts/identity'
export const IDs = {
  connection: identity.connectionIdSchema.parse('connection'),
  project: identity.projectIdSchema.parse('project'),
  map: identity.mapIdSchema.parse('map'),
  ticket: identity.ticketIdSchema.parse('ticket'),
  authorization: identity.authorizationOperationIdSchema.parse('authorization'),
  action: identity.actionIdSchema.parse('action'),
  epoch: identity.serverEpochSchema.parse('epoch'),
  sequence: identity.stateSequenceSchema.parse(0),
  version: identity.configurationVersionSchema.parse(0),
  correlation: identity.correlationIdSchema.parse('00000000-0000-4000-8000-000000000001'),
}
export const project = identity.localProjectRefSchema.parse({
  integration: 'local',
  projectId: 'project',
})
export const githubProject = identity.githubProjectRefSchema.parse({
  integration: 'github',
  projectId: 'project',
})
export const map = identity.mapRefSchema.parse({ project, mapId: 'map' })
export const ticket = identity.ticketRefSchema.parse({ map, ticketId: 'ticket' })
export declare const validLocalProject: Extract<
  import('@roadmap/contracts/state').Project,
  { integration: 'local' }
>
export declare const validGitHubProject: Extract<
  import('@roadmap/contracts/state').Project,
  { integration: 'github' }
>
