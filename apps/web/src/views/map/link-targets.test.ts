import { mapIdSchema, projectIdSchema } from '@roadmap/contracts/identity'
import type { MapResource } from '@roadmap/contracts/state'
import { describe, expect, it } from 'vitest'
import { resourceObservation } from '@/resources/results'
import { resolveProseLink } from './link-targets'
import { makeMap as resourceMap, ticket } from './test-fixtures'

const ROOT = '/Users/asmund.wien/source/hdir/platform/microsoft-risiko'

function makeMap(): MapResource {
  const mapDirectory = `${ROOT}/.wayfinder/azure-strategy-leadership-deck`
  return resourceMap(
    [
      ticket('2', 'closed', [], undefined, 0, 'research', {
        displayId: '2',
        title: 'Scroll story',
        source: { kind: 'file', path: `${mapDirectory}/tickets/02-re-story-for-scroll.md` },
      }),
      ticket('16', 'frontier', [], undefined, 0, 'task', {
        displayId: '16',
        title: 'Landing orientation',
        source: { kind: 'file', path: `${mapDirectory}/tickets/16-landing-orientation.md` },
      }),
    ],
    { destination: '' },
    {
      project: { integration: 'local', projectId: projectIdSchema.parse('microsoft-risiko') },
      mapId: mapIdSchema.parse('.wayfinder/azure-strategy-leadership-deck/map.md'),
    },
    { title: 'Microsoft Risiko', source: { kind: 'file', path: `${mapDirectory}/map.md` } },
  )
}

describe('resolveProseLink', () => {
  it('turns a map decision link into an on-map ticket selection', () => {
    expect(
      resolveProseLink(
        makeMap(),
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/map.md`,
        'tickets/02-re-story-for-scroll.md',
      ),
    ).toEqual({
      kind: 'selection',
      selection: { kind: 'ticket', id: '2' },
    })
  })

  it('turns a sibling ticket link into an on-map ticket selection', () => {
    expect(
      resolveProseLink(
        makeMap(),
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/tickets/16-landing-orientation.md`,
        '02-re-story-for-scroll.md',
      ),
    ).toEqual({ kind: 'selection', selection: { kind: 'ticket', id: '2' } })
  })

  it('turns a link back to the map file into a map selection', () => {
    expect(
      resolveProseLink(
        makeMap(),
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/tickets/16-landing-orientation.md`,
        '../map.md',
      ),
    ).toEqual({
      kind: 'selection',
      selection: { kind: 'map' },
    })
  })

  it('preserves literal percent escapes in the source directory for relative selections', () => {
    const directory = '/workspace/.wayfinder/resource%2F:α space'
    const map = resourceMap(
      [
        ticket('2', 'frontier', [], undefined, 0, 'task', {
          source: { kind: 'file', path: `${directory}/tickets/ticket.md` },
        }),
      ],
      {},
      {
        project: { integration: 'local', projectId: projectIdSchema.parse('opaque-project') },
        mapId: mapIdSchema.parse('.wayfinder/resource%2F:α space/map.md'),
      },
      { source: { kind: 'file', path: `${directory}/map.md` } },
    )
    expect(resolveProseLink(map, `${directory}/map.md`, 'tickets/ticket.md')).toEqual({
      kind: 'selection',
      selection: { kind: 'ticket', id: '2' },
    })
    expect(resolveProseLink(map, `${directory}/tickets/ticket.md`, '../map.md')).toEqual({
      kind: 'selection',
      selection: { kind: 'map' },
    })
  })

  it('keeps unsupported local document links visibly inert', () => {
    expect(
      resolveProseLink(
        makeMap(),
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/tickets/02-re-story-for-scroll.md`,
        '../../../docs/page-list.md',
      ),
    ).toMatchObject({ kind: 'disabled' })
  })

  it('leaves absolute web links alone', () => {
    expect(
      resolveProseLink(
        makeMap(),
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/map.md`,
        'https://example.com',
      ),
    ).toEqual({
      kind: 'href',
      href: 'https://example.com',
    })
  })
})

describe('resource trace source links', () => {
  it('keeps a local historical ticket destination under unavailable map evidence', () => {
    const map = makeMap()
    const observation = resourceObservation(map.resource)
    const first = map.tickets[0]
    const ticketObservation = first === undefined ? null : resourceObservation(first.resource)
    if (observation === null || first === undefined || ticketObservation === null)
      throw new Error('Expected source observations')
    map.resource = {
      kind: 'retained-unavailable',
      lastSuccessful: observation,
      unavailable: {
        kind: 'no-current-evidence',
        scope: observation.scope,
        cause: 'No current source observation is available.',
      },
    }
    first.resource = {
      kind: 'proven-absent',
      absence: {
        scope: ticketObservation.scope,
        attemptedAt: 1000,
        observedAt: 1000,
        provenance: {
          integration: 'local',
          path: `${ROOT}/.wayfinder/azure-strategy-leadership-deck/tickets`,
          operation: 'enumerate',
        },
        proof: {
          kind: 'complete-membership',
          parent: { kind: 'tickets-membership', map: map.ref },
        },
      },
      trace: { kind: 'last-successful-trace', lastSuccessful: ticketObservation },
    }
    if (map.ticketsMembership.kind !== 'current-complete')
      throw new Error('Expected complete membership')
    map.ticketsMembership.observation.attemptedAt = 1000
    map.ticketsMembership.observation.observedAt = 1000
    map.ticketsMembership.observation.value.members =
      map.ticketsMembership.observation.value.members.filter(
        (member) => member.ticketId !== first.ref.ticketId,
      )

    expect(
      resolveProseLink(
        map,
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/map.md`,
        'tickets/02-re-story-for-scroll.md',
      ),
    ).toEqual({
      kind: 'selection',
      selection: { kind: 'ticket', id: '2' },
    })
    expect(
      resolveProseLink(
        map,
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/tickets/02-re-story-for-scroll.md`,
        '../map.md',
      ),
    ).toEqual({
      kind: 'selection',
      selection: { kind: 'map' },
    })
  })

  it('uses the actual recovered ticket path instead of a prior same-key destination', () => {
    const map = makeMap()
    const first = map.tickets[0]
    if (first === undefined || first.resource.kind !== 'current-readable')
      throw new Error('Expected readable ticket')
    const path = `${ROOT}/.wayfinder/azure-strategy-leadership-deck/tickets/recovered-story.md`
    first.resource.observation.value.source = { kind: 'file', path }
    first.resource.observation.provenance = { integration: 'local', path, operation: 'read' }
    first.resource.observation.attemptedAt = 2000
    first.resource.observation.observedAt = 2000

    expect(
      resolveProseLink(
        map,
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/map.md`,
        'tickets/recovered-story.md',
      ),
    ).toEqual({
      kind: 'selection',
      selection: { kind: 'ticket', id: '2' },
    })
    expect(
      resolveProseLink(
        map,
        `${ROOT}/.wayfinder/azure-strategy-leadership-deck/map.md`,
        'tickets/02-re-story-for-scroll.md',
      )?.kind,
    ).toBe('disabled')
  })
})
