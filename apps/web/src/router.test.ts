import {
  connectionIdSchema,
  mapIdSchema,
  projectIdSchema,
  ticketIdSchema,
} from '@roadmap/contracts/identity'
import { describe, expect, it } from 'vitest'
import {
  connectionPath,
  mapPath,
  pathParams,
  projectPath,
  projectRoute,
  routePaths,
  ticketPath,
} from './router'

const localProject = {
  integration: 'local',
  projectId: projectIdSchema.parse('work / café %2F#1'),
} satisfies Parameters<typeof projectPath>[0]
const localMap = { project: localProject, mapId: mapIdSchema.parse('.wayfinder/路线 2/%2F#map.md') }

describe('resource link identity', () => {
  it('keeps a GitHub owner/repository ID in one project parameter', () => {
    expect(
      pathParams(
        routePaths.project,
        projectPath({
          integration: 'github',
          projectId: projectIdSchema.parse('asmundwien/roadmap'),
        }),
      ),
    ).toEqual({ integration: 'github', projectId: projectIdSchema.parse('asmundwien/roadmap') })
  })

  it('preserves opaque Local project identity without decoding a literal %2F twice', () => {
    expect(pathParams(routePaths.project, projectPath(localProject))).toEqual({
      integration: 'local',
      projectId: projectIdSchema.parse('work / café %2F#1'),
    })
  })

  it('preserves opaque project and map identities in a map link', () => {
    expect(pathParams(routePaths.map, mapPath(localMap))).toEqual({
      integration: 'local',
      projectId: projectIdSchema.parse('work / café %2F#1'),
      mapId: mapIdSchema.parse('.wayfinder/路线 2/%2F#map.md'),
    })
  })

  it('preserves opaque project, map, and ticket identities in a ticket link', () => {
    expect(
      pathParams(
        routePaths.ticket,
        ticketPath({ map: localMap, ticketId: ticketIdSchema.parse('tickets/问题 a %2F#2.md') }),
      ),
    ).toEqual({
      integration: 'local',
      projectId: projectIdSchema.parse('work / café %2F#1'),
      mapId: mapIdSchema.parse('.wayfinder/路线 2/%2F#map.md'),
      ticketId: ticketIdSchema.parse('tickets/问题 a %2F#2.md'),
    })
  })

  it('keeps colon-prefixed project and map IDs literal in a nested ticket link', () => {
    const map = {
      project: { integration: 'local', projectId: projectIdSchema.parse(':projectId') },
      mapId: mapIdSchema.parse(':mapId'),
    } satisfies Parameters<typeof mapPath>[0]
    expect(
      pathParams(
        routePaths.ticket,
        ticketPath({ map, ticketId: ticketIdSchema.parse('ticket-1') }),
      ),
    ).toEqual({
      integration: 'local',
      projectId: projectIdSchema.parse(':projectId'),
      mapId: mapIdSchema.parse(':mapId'),
      ticketId: ticketIdSchema.parse('ticket-1'),
    })
  })

  it('preserves opaque connection identity with percent, slash, and Unicode', () => {
    expect(
      pathParams(
        routePaths.connection,
        connectionPath(connectionIdSchema.parse('local / café %2F#1')),
      ),
    ).toEqual({
      connectionId: connectionIdSchema.parse('local / café %2F#1'),
    })
  })

  it('rejects malformed encoded parameters without returning partial identity', () => {
    expect(pathParams(routePaths.ticket, '/projects/local/work/maps/map/tickets/%E0%A4%A')).toEqual(
      {},
    )
  })

  it('translates the original encoded route once into complete nested semantic references', () => {
    expect(
      projectRoute(
        routePaths.ticket,
        '/projects/local/work%20%252F/maps/map%2Fone/tickets/ticket%20%252F',
      ),
    ).toEqual({
      project: { integration: 'local', projectId: 'work %2F' },
      map: { project: { integration: 'local', projectId: 'work %2F' }, mapId: 'map/one' },
      ticket: {
        map: { project: { integration: 'local', projectId: 'work %2F' }, mapId: 'map/one' },
        ticketId: 'ticket %2F',
      },
    })
  })

  it('rejects an unknown Integration without inventing a Project reference', () => {
    expect(projectRoute(routePaths.project, '/projects/unknown/opaque%20identity')).toBeNull()
  })
})
