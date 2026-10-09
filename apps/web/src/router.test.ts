import { describe, expect, it } from 'vitest'
import { connectionPath, mapPath, pathParams, projectPath, routePaths, ticketPath } from './router'

const localProject = {
  integration: 'local',
  id: 'work / café %2F#1',
} satisfies Parameters<typeof projectPath>[0]
const localMap = { project: localProject, mapId: '.wayfinder/路线 2/%2F#map.md' }

describe('resource link identity', () => {
  it('keeps a GitHub owner/repository ID in one project parameter', () => {
    expect(
      pathParams(
        routePaths.project,
        projectPath({ integration: 'github', id: 'asmundwien/roadmap' }),
      ),
    ).toEqual({ integration: 'github', projectId: 'asmundwien/roadmap' })
  })

  it('preserves opaque Local project identity without decoding a literal %2F twice', () => {
    expect(pathParams(routePaths.project, projectPath(localProject))).toEqual({
      integration: 'local',
      projectId: 'work / café %2F#1',
    })
  })

  it('preserves opaque project and map identities in a map link', () => {
    expect(pathParams(routePaths.map, mapPath(localMap))).toEqual({
      integration: 'local',
      projectId: 'work / café %2F#1',
      mapId: '.wayfinder/路线 2/%2F#map.md',
    })
  })

  it('preserves opaque project, map, and ticket identities in a ticket link', () => {
    expect(
      pathParams(
        routePaths.ticket,
        ticketPath({ map: localMap, ticketId: 'tickets/问题 a %2F#2.md' }),
      ),
    ).toEqual({
      integration: 'local',
      projectId: 'work / café %2F#1',
      mapId: '.wayfinder/路线 2/%2F#map.md',
      ticketId: 'tickets/问题 a %2F#2.md',
    })
  })

  it('keeps colon-prefixed project and map IDs literal in a nested ticket link', () => {
    const map = {
      project: { integration: 'local', id: ':projectId' },
      mapId: ':mapId',
    } satisfies Parameters<typeof mapPath>[0]
    expect(pathParams(routePaths.ticket, ticketPath({ map, ticketId: 'ticket-1' }))).toEqual({
      integration: 'local',
      projectId: ':projectId',
      mapId: ':mapId',
      ticketId: 'ticket-1',
    })
  })

  it('preserves opaque connection identity with percent, slash, and Unicode', () => {
    expect(pathParams(routePaths.connection, connectionPath('local / café %2F#1'))).toEqual({
      connectionId: 'local / café %2F#1',
    })
  })

  it('rejects malformed encoded parameters without returning partial identity', () => {
    expect(pathParams(routePaths.ticket, '/projects/local/work/maps/map/tickets/%E0%A4%A')).toEqual(
      {},
    )
  })
})
