import {
  activeMapSchema,
  mapResourceSchema,
  projectResourceSchema,
  projectSchema,
  ticketResourceSchema,
} from '@roadmap/contracts/state'
import { decodeApplicationState } from '@roadmap/contracts/wire'
import { describe, expect, test } from 'vitest'

function applicationWithProgress(progress: unknown, ticketsComplete = false) {
  const fixture = scopedResourceFixture()
  const original = fixture.aggregate.maps[0]
  const originalTicket = original?.tickets[0]
  if (!original || !originalTicket) throw new Error('Expected scoped map and ticket fixtures')
  const map = {
    ...original,
    frontier: [],
    resource: {
      kind: 'current-readable',
      observation: {
        ...fixture.mapObservation,
        value: {
          ...fixture.mapObservation.value,
          body: { ...fixture.mapObservation.value.body, raw: 'Readable source map' },
          progress,
        },
      },
    },
    ticketsMembership: ticketsComplete
      ? original.ticketsMembership
      : {
          kind: 'current-incomplete',
          observation: {
            ...original.ticketsMembership.observation,
            completeness: { kind: 'incomplete', reason: 'pagination' },
          },
          lastComplete: null,
        },
    tickets: [
      {
        ...originalTicket,
        resource: {
          kind: 'current-readable',
          observation: {
            ...fixture.ticketObservation,
            value: { ...fixture.ticketObservation.value, status: 'closed', state: 'closed' },
          },
        },
      },
    ],
  }
  return {
    phase: 'ready',
    mode: 'mutable',
    capturedAt: 1,
    serverEpoch: 'test',
    stateSequence: 0,
    configurationVersion: 0,
    supportedIntegrations: [],
    connections: [
      {
        id: 'local',
        integration: 'local',
        name: 'Local',
        builtIn: true,
        availability: { status: 'available' },
      },
    ],
    projects: [
      {
        ...fixture.aggregate,
        connectionId: 'local',
        integration: 'local',
        source: { integration: 'local', path: '/fixture' },
        management: {},
        name: 'Configured Project',
        actions: [],
        managementWarnings: [],
        maps: [map],
        activeMap: ticketsComplete
          ? fixture.aggregate.activeMap
          : {
              kind: 'uncertain',
              reason: 'map-incomplete',
              cause: 'A map required for ordering is incomplete.',
            },
      },
    ],
    authorizationOperations: [],
    configuration: { valid: true, issues: [], notices: [] },
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
  }
}

describe('source progress public boundary', () => {
  test('round-trips unknown upstream totals as null on a readable incomplete map', () => {
    const input = applicationWithProgress(null)
    const decoded = decodeApplicationState(JSON.parse(JSON.stringify(input)))
    expect(decoded).toEqual({ ok: true, value: input })
    if (!decoded.ok) throw new Error('Expected unknown progress to decode')
    if (decoded.value.phase !== 'ready') throw new Error('Expected a complete ready fixture.')
    const map = decoded.value.projects[0]?.maps[0]
    if (!map || map.resource.kind !== 'current-readable') throw new Error('Expected readable map')
    expect(map.resource.observation.value.progress).toBeNull()
    expect(map.ticketsMembership.kind).toBe('current-incomplete')
    expect(map.resource.observation.value.body.raw).toBe('Readable source map')
    expect(decodeApplicationState(JSON.parse(JSON.stringify(decoded.value)))).toEqual(decoded)
  })

  test('preserves numeric progress for a complete fetched ticket collection', () => {
    const input = applicationWithProgress({ total: 1, completed: 1 }, true)
    expect(decodeApplicationState(JSON.parse(JSON.stringify(input)))).toEqual({
      ok: true,
      value: input,
    })
  })

  test('accepts known upstream totals beyond an incomplete fetched subset', () => {
    const input = applicationWithProgress({ total: 40, completed: 17 })
    const decoded = decodeApplicationState(JSON.parse(JSON.stringify(input)))
    expect(decoded).toEqual({ ok: true, value: input })
    if (!decoded.ok) throw new Error('Expected known upstream progress to decode')
    if (decoded.value.phase !== 'ready') throw new Error('Expected a complete ready fixture.')
    const map = decoded.value.projects[0]?.maps[0]
    if (!map || map.resource.kind !== 'current-readable') throw new Error('Expected readable map')
    expect(map.tickets).toHaveLength(1)
    expect(map.resource.observation.value.progress).toEqual({ total: 40, completed: 17 })
    expect(map.ticketsMembership.kind).toBe('current-incomplete')
  })

  test('refuses malformed counts without inventing an aggregate', () => {
    expect(decodeApplicationState(applicationWithProgress({ total: -1, completed: 0 })).ok).toBe(
      false,
    )
  })

  test('requires the progress field even when totals are unknown', () => {
    const input = applicationWithProgress(null)
    const project = input.projects[0]
    const original = project?.maps[0]
    if (!project || !original) throw new Error('Expected a map in the progress fixture')
    const { progress: _progress, ...value } = original.resource.observation.value
    const map = {
      ...original,
      resource: { ...original.resource, observation: { ...original.resource.observation, value } },
    }
    const withoutProgress = { ...input, projects: [{ ...project, maps: [map] }] }
    expect(decodeApplicationState(withoutProgress).ok).toBe(false)
  })
})

describe('resource own-data boundary', () => {
  test('rejects an inherited resource discriminator at the schema and decoder boundaries', () => {
    const fixture = scopedResourceFixture()
    const resource = Object.assign(Object.create({ kind: 'never-observed' }), {
      scope: fixture.projectObservation.scope,
      current: null,
    })
    expect(projectResourceSchema.safeParse(resource).success).toBe(false)
    const input = applicationWithProgress(null)
    const project = input.projects[0]
    if (!project) throw new Error('Expected a Project fixture')
    expect(decodeApplicationState({ ...input, projects: [{ ...project, resource }] }).ok).toBe(
      false,
    )
  })

  test('rejects inherited required nested payload fields', () => {
    const fixture = scopedResourceFixture()
    const { name, ...ownValue } = fixture.projectObservation.value
    const value = Object.assign(Object.create({ name }), ownValue)
    const resource = {
      kind: 'current-readable',
      observation: { ...fixture.projectObservation, value },
    }
    expect(projectResourceSchema.safeParse(resource).success).toBe(false)
    const input = applicationWithProgress(null)
    const project = input.projects[0]
    if (!project) throw new Error('Expected a Project fixture')
    expect(decodeApplicationState({ ...input, projects: [{ ...project, resource }] }).ok).toBe(
      false,
    )
  })

  test('rejects resource and nested accessors without invoking getters', () => {
    const fixture = scopedResourceFixture()
    let getterEffects = 0
    const resource = Object.defineProperty(
      { scope: fixture.projectObservation.scope, current: null },
      'kind',
      {
        enumerable: true,
        get: () => {
          getterEffects++
          return 'never-observed'
        },
      },
    )
    const value = Object.defineProperty({ ...fixture.projectObservation.value }, 'name', {
      enumerable: true,
      get: () => {
        getterEffects++
        return 'credential-that-must-not-be-read'
      },
    })
    const nested = {
      kind: 'current-readable',
      observation: { ...fixture.projectObservation, value },
    }
    for (const candidate of [resource, nested]) {
      const result = projectResourceSchema.safeParse(candidate)
      expect(result.success).toBe(false)
      expect(JSON.stringify(result)).not.toContain('credential-that-must-not-be-read')
      const input = applicationWithProgress(null)
      const project = input.projects[0]
      if (!project) throw new Error('Expected a Project fixture')
      expect(
        decodeApplicationState({ ...input, projects: [{ ...project, resource: candidate }] }).ok,
      ).toBe(false)
    }
    expect(getterEffects).toBe(0)
  })

  test('rejects inherited and accessor blocker references without getter effects', () => {
    const fixture = scopedResourceFixture()
    let getterEffects = 0
    const blockerTicket = {
      map: fixture.ticketObservation.scope.ticket.map,
      ticketId: 'external/blocker',
    }
    const inherited = Object.assign(Object.create({ kind: 'registered' }), {
      ticket: blockerTicket,
    })
    const accessor = Object.defineProperty({ kind: 'registered' }, 'ticket', {
      enumerable: true,
      get: () => {
        getterEffects++
        return blockerTicket
      },
    })
    const inheritedProject = {
      kind: 'registered',
      ticket: {
        ...blockerTicket,
        map: {
          ...blockerTicket.map,
          project: Object.assign(
            Object.create({ projectId: fixture.projectObservation.scope.project.projectId }),
            { integration: 'local' },
          ),
        },
      },
    }
    for (const reference of [inherited, accessor, inheritedProject]) {
      const resource = {
        kind: 'current-readable',
        observation: {
          ...fixture.ticketObservation,
          value: {
            ...fixture.ticketObservation.value,
            blockedBy: [{ reference, state: 'open' }],
          },
        },
      }
      expect(ticketResourceSchema.safeParse(resource).success).toBe(false)
      const input = applicationWithProgress(null)
      const project = input.projects[0]
      const map = project?.maps[0]
      const ticket = map?.tickets[0]
      if (!project || !map || !ticket) throw new Error('Expected Project, map and Ticket fixtures')
      const projects = [
        {
          ...project,
          maps: [{ ...map, tickets: [{ ...ticket, resource }] }],
        },
      ]
      expect(decodeApplicationState({ ...input, projects }).ok).toBe(false)
    }
    expect(getterEffects).toBe(0)
  })

  test('preserves legal null-prototype resource and nested payload objects', () => {
    const fixture = scopedResourceFixture()
    const value = Object.assign(Object.create(null), fixture.projectObservation.value)
    const resource = Object.assign(Object.create(null), {
      kind: 'current-readable',
      observation: { ...fixture.projectObservation, value },
    })
    expect(projectResourceSchema.safeParse(resource).success).toBe(true)
  })
})

describe('resource array own-data boundary', () => {
  test.each([
    ['schema', false],
    ['schema', true],
    ['decoder', false],
    ['decoder', true],
  ])(
    'rejects numeric accessors before reads at the %s boundary, throwing=%s',
    (boundary, throws) => {
      const fixture = scopedResourceFixture()
      let getterEffects = 0
      const warnings = Object.defineProperty([], '0', {
        enumerable: true,
        get: () => {
          getterEffects++
          if (throws) throw new Error('resource-array-accessor')
          return 'credential-that-must-not-be-read'
        },
      })
      const resource = {
        kind: 'current-readable',
        observation: {
          ...fixture.projectObservation,
          value: { ...fixture.projectObservation.value, warnings },
        },
      }
      let accepted: boolean | undefined
      let thrown: unknown
      try {
        accepted =
          boundary === 'schema'
            ? projectResourceSchema.safeParse(resource).success
            : decodeApplicationState(applicationWithResources({ ...fixture.aggregate, resource }))
                .ok
      } catch (error) {
        thrown = error
      }
      expect({ accepted, getterEffects, thrown }).toEqual({
        accepted: false,
        getterEffects: 0,
        thrown: undefined,
      })
    },
  )

  test.each(['plain', 'null-prototype'])(
    'preserves dense own-data arrays and %s objects',
    (prototype) => {
      const fixture = scopedResourceFixture()
      const warnings = ['Actual warning']
      const value = { ...fixture.projectObservation.value, warnings }
      const resource = {
        kind: 'current-readable',
        observation: { ...fixture.projectObservation, value },
      }
      if (prototype === 'null-prototype') {
        Object.setPrototypeOf(warnings, null)
        Object.setPrototypeOf(value, null)
        Object.setPrototypeOf(resource.observation, null)
        Object.setPrototypeOf(resource, null)
      }
      const parsed = projectResourceSchema.safeParse(resource)
      expect(parsed).toMatchObject({ success: true, data: resource })
      const input = applicationWithResources({ ...fixture.aggregate, resource })
      expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
    },
  )

  test('guards nested payload, membership, resource and display-order collections before element access', () => {
    const fixture = scopedResourceFixture()
    const map = fixture.aggregate.maps[0]
    const ticket = map?.tickets[0]
    if (!map || !ticket) throw new Error('Expected scoped map and Ticket fixtures')
    const withMap = (replacement: object) => ({
      ...fixture.aggregate,
      maps: [{ ...map, ...replacement }],
    })
    const collections = [
      {
        name: 'map body notes',
        entries: ['Actual note'],
        withArray: (notes: unknown[]) =>
          withMap({
            resource: {
              kind: 'current-readable',
              observation: {
                ...fixture.mapObservation,
                value: {
                  ...fixture.mapObservation.value,
                  body: { ...fixture.mapObservation.value.body, notes },
                },
              },
            },
          }),
      },
      {
        name: 'ticket blocker collection',
        entries: [
          {
            reference: {
              kind: 'registered',
              ticket: {
                map: fixture.ticketObservation.scope.ticket.map,
                ticketId: 'external/blocker',
              },
            },
            state: 'closed',
          },
        ],
        withArray: (blockedBy: unknown[]) =>
          withMap({
            tickets: [
              {
                ...ticket,
                resource: {
                  kind: 'current-readable',
                  observation: {
                    ...fixture.ticketObservation,
                    value: { ...fixture.ticketObservation.value, blockedBy },
                  },
                },
              },
            ],
          }),
      },
      {
        name: 'map membership',
        entries: [map.ref],
        withArray: (members: unknown[]) => ({
          ...fixture.aggregate,
          mapsMembership: {
            ...fixture.aggregate.mapsMembership,
            observation: { ...fixture.aggregate.mapsMembership.observation, value: { members } },
          },
        }),
      },
      {
        name: 'ticket membership',
        entries: [ticket.ref],
        withArray: (members: unknown[]) =>
          withMap({
            ticketsMembership: {
              ...map.ticketsMembership,
              observation: { ...map.ticketsMembership.observation, value: { members } },
            },
          }),
      },
      {
        name: 'maps',
        entries: [map],
        withArray: (maps: unknown[]) => ({ ...fixture.aggregate, maps }),
      },
      {
        name: 'tickets',
        entries: [ticket],
        withArray: (tickets: unknown[]) => withMap({ tickets }),
      },
      {
        name: 'open map display order',
        entries: [map.ref],
        withArray: (open: unknown[]) => ({
          ...fixture.aggregate,
          displayOrder: { ...fixture.aggregate.displayOrder, open },
        }),
      },
    ]
    for (const collection of collections) {
      const valid = collection.withArray(collection.entries)
      expect(projectSchema.safeParse(valid).success, collection.name).toBe(true)
      expect(decodeApplicationState(applicationWithResources(valid)).ok, collection.name).toBe(true)
      for (const throws of [false, true]) {
        let getterEffects = 0
        const entries = Object.defineProperty([], '0', {
          enumerable: true,
          get: () => {
            getterEffects++
            if (throws) throw new Error(`resource-array-accessor:${collection.name}`)
            return collection.entries[0]
          },
        })
        const candidate = collection.withArray(entries)
        for (const boundary of ['schema', 'decoder']) {
          let accepted: boolean | undefined
          let thrown: unknown
          try {
            accepted =
              boundary === 'schema'
                ? projectSchema.safeParse(candidate).success
                : decodeApplicationState(applicationWithResources(candidate)).ok
          } catch (error) {
            thrown = error
          }
          expect(
            { accepted, getterEffects, thrown },
            `${collection.name}, ${boundary}, throwing=${throws}`,
          ).toEqual({
            accepted: false,
            getterEffects: 0,
            thrown: undefined,
          })
        }
      }
    }
  })
})

function applicationWithResources(resources: object) {
  const input = applicationWithProgress({ total: 1, completed: 0 }, true)
  const project = input.projects[0]
  if (!project) throw new Error('Expected a registered Project fixture')
  return { ...input, projects: [{ ...project, ...resources }], capturedAt: 400 }
}

describe('resource timestamp consumer boundary', () => {
  test.each([0, 8_640_000_000_000_000])(
    'accepts the Date-representable observedAt boundary %s',
    (observedAt) => {
      const fixture = scopedResourceFixture()
      const resource = {
        kind: 'current-readable',
        observation: { ...fixture.projectObservation, attemptedAt: 0, observedAt },
      }
      expect(projectResourceSchema.safeParse(resource)).toMatchObject({
        success: true,
        data: resource,
      })
      const input = applicationWithResources({ ...fixture.aggregate, resource })
      expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
    },
  )

  test.each([8_640_000_000_000_001, Number.MAX_VALUE])(
    'refuses finite observedAt outside the Date range: %s',
    (observedAt) => {
      const fixture = scopedResourceFixture()
      const resource = {
        kind: 'current-readable',
        observation: { ...fixture.projectObservation, observedAt },
      }
      const parsed = projectResourceSchema.safeParse(resource)
      expect(parsed.success).toBe(false)
      if (parsed.success) throw new Error('Expected out-of-range timestamp rejection')
      expect(
        parsed.error.issues.some((issue) => issue.path.join('.') === 'observation.observedAt'),
      ).toBe(true)
      const decoded = decodeApplicationState(
        applicationWithResources({ ...fixture.aggregate, resource }),
      )
      expect(decoded.ok).toBe(false)
      if (decoded.ok) throw new Error('Expected decoder timestamp rejection')
      expect(
        decoded.issues.some((issue) => issue.path.includes('resource.observation.observedAt')),
      ).toBe(true)
    },
  )

  test('refuses out-of-range retained, unavailable, absence and payload timestamps', () => {
    const fixture = scopedResourceFixture()
    const beyondDate = 8_640_000_000_000_001
    const candidates = [
      {
        schema: projectResourceSchema,
        resource: {
          kind: 'current-readable',
          observation: {
            ...fixture.projectObservation,
            attemptedAt: beyondDate,
            observedAt: beyondDate,
          },
        },
      },
      {
        schema: mapResourceSchema,
        resource: {
          kind: 'current-readable',
          observation: {
            ...fixture.mapObservation,
            value: { ...fixture.mapObservation.value, updatedAt: beyondDate },
          },
        },
      },
      {
        schema: ticketResourceSchema,
        resource: {
          kind: 'current-readable',
          observation: {
            ...fixture.ticketObservation,
            value: { ...fixture.ticketObservation.value, createdAt: beyondDate },
          },
        },
      },
      {
        schema: mapResourceSchema,
        resource: {
          kind: 'retained-unavailable',
          lastSuccessful: { ...fixture.mapObservation, observedAt: beyondDate },
          unavailable: {
            kind: 'no-current-evidence',
            scope: fixture.mapScope,
            cause: 'No current source observation is available.',
          },
        },
      },
      {
        schema: mapResourceSchema,
        resource: {
          kind: 'retained-unavailable',
          lastSuccessful: fixture.mapObservation,
          unavailable: { ...fixture.unavailable, attemptedAt: beyondDate },
        },
      },
      {
        schema: mapResourceSchema,
        resource: {
          kind: 'proven-absent',
          absence: { ...fixture.absence, observedAt: beyondDate },
          trace: { kind: 'last-successful-trace', lastSuccessful: fixture.mapObservation },
        },
      },
    ]
    for (const { schema, resource } of candidates)
      expect(schema.safeParse(resource).success).toBe(false)
  })
})

function aggregateWithBlocker(
  state: 'open' | 'closed' | 'unknown',
  isClaimed = false,
  blockersComplete = true,
) {
  const fixture = scopedResourceFixture()
  const map = fixture.aggregate.maps[0]
  const ticket = map?.tickets[0]
  if (!map || !ticket) throw new Error('Expected scoped map and Ticket fixtures')
  const isBlocked = state !== 'closed'
  const resource = {
    kind: 'current-readable',
    observation: {
      ...fixture.ticketObservation,
      value: {
        ...fixture.ticketObservation.value,
        state: isBlocked ? 'blocked' : isClaimed ? 'claimed' : 'frontier',
        isClaimed,
        isBlocked,
        blockedBy: [
          {
            reference: {
              kind: 'registered',
              ticket: {
                map: fixture.ticketObservation.scope.ticket.map,
                ticketId: 'external/blocker',
              },
            },
            state,
          },
        ],
        blockersComplete,
      },
    },
  }
  return {
    ...fixture.aggregate,
    maps: [
      {
        ...map,
        frontier: state === 'closed' && !isClaimed && blockersComplete ? [ticket.ref] : [],
        tickets: [{ ...ticket, resource }],
      },
    ],
  }
}

describe('active-map blocker certainty boundary', () => {
  test('refuses known active order for an unknown blocker even when blocker membership is complete', () => {
    const aggregate = aggregateWithBlocker('unknown')
    const ticket = aggregate.maps[0]?.tickets[0]
    if (!ticket) throw new Error('Expected a Ticket fixture')
    expect(ticketResourceSchema.safeParse(ticket.resource).success).toBe(true)
    const parsed = projectSchema.safeParse(aggregate)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected unknown blocker to reject known active certainty')
    expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'activeMap')).toBe(true)
    expect(decodeApplicationState(applicationWithResources(aggregate)).ok).toBe(false)
  })

  test.each([
    ['open', false],
    ['open', true],
    ['closed', false],
    ['closed', true],
  ] satisfies ['open' | 'closed', boolean][])(
    'preserves known %s blockers with independent claimed=%s evidence',
    (state, isClaimed) => {
      const aggregate = aggregateWithBlocker(state, isClaimed)
      expect(projectSchema.safeParse(aggregate)).toMatchObject({
        success: true,
        data: aggregate,
      })
      const input = applicationWithResources(aggregate)
      expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
    },
  )

  test.each([true, false])(
    'preserves readable claimed and blocked content under uncertain order, blockersComplete=%s',
    (blockersComplete) => {
      const aggregate = {
        ...aggregateWithBlocker('unknown', true, blockersComplete),
        activeMap: {
          kind: 'uncertain',
          reason: 'map-incomplete',
          cause: 'A map required for ordering is incomplete.',
        },
      }
      const ticket = aggregate.maps[0]?.tickets[0]
      if (!ticket) throw new Error('Expected a Ticket fixture')
      expect(ticketResourceSchema.safeParse(ticket.resource)).toMatchObject({
        success: true,
        data: {
          observation: {
            value: {
              body: 'Actual ticket prose',
              state: 'blocked',
              isClaimed: true,
              isBlocked: true,
              blockersComplete,
            },
          },
        },
      })
      expect(projectSchema.safeParse(aggregate)).toMatchObject({
        success: true,
        data: aggregate,
      })
      const input = applicationWithResources(aggregate)
      expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
    },
  )
})

function scopedResourceFixture() {
  const project = { integration: 'local', projectId: 'opaque/Project:%2F' }
  const map = { project, mapId: 'same/map' }
  const ticket = { map, ticketId: 'same/ticket' }
  const projectScope = { kind: 'project', project }
  const mapScope = { kind: 'map', map }
  const ticketScope = { kind: 'ticket', ticket }
  const mapsScope = { kind: 'maps-membership', project }
  const ticketsScope = { kind: 'tickets-membership', map }
  const read = { integration: 'local', path: '/fixture/map.md', operation: 'read' }
  const enumerate = { integration: 'local', path: '/fixture/maps', operation: 'enumerate' }
  const projectObservation = {
    scope: projectScope,
    attemptedAt: 100,
    observedAt: 101,
    provenance: { integration: 'local', path: '/fixture', operation: 'inspect-root' },
    completeness: { kind: 'complete' },
    value: {
      name: 'Observed Project',
      source: { integration: 'local', path: '/fixture' },
      warnings: [],
    },
  }
  const mapObservation = {
    scope: mapScope,
    attemptedAt: 100,
    observedAt: 101,
    provenance: read,
    completeness: { kind: 'complete' },
    value: {
      title: 'Observed map',
      source: { kind: 'file', path: '/fixture/map.md' },
      status: 'open',
      updatedAt: 90,
      body: {
        raw: 'Actual map prose',
        destination: 'Actual destination',
        notes: [],
        decisions: [],
        notYetSpecified: [],
        notYetSpecifiedNote: '',
        outOfScope: [],
        sections: [],
        missingSections: [],
      },
      progress: { total: 1, completed: 0 },
      warnings: [],
    },
  }
  const ticketObservation = {
    scope: ticketScope,
    attemptedAt: 100,
    observedAt: 101,
    provenance: { ...read, path: '/fixture/ticket.md' },
    completeness: { kind: 'complete' },
    value: {
      title: 'Observed ticket',
      source: { kind: 'file', path: '/fixture/ticket.md' },
      status: 'open',
      body: 'Actual ticket prose',
      typeEvidence: { kind: 'missing', labels: [] },
      state: 'frontier',
      isClaimed: false,
      isBlocked: false,
      assignees: [],
      blockedBy: [],
      blockersComplete: true,
      warnings: [],
    },
  }
  const unavailable = {
    kind: 'source-failure',
    scope: mapsScope,
    attemptedAt: 200,
    provenance: enumerate,
    failure: { kind: 'filesystem', operation: 'enumerate', code: 'EACCES' },
    cause: 'Source read permission was denied.',
  }
  const absence = {
    scope: mapScope,
    attemptedAt: 300,
    observedAt: 301,
    provenance: enumerate,
    proof: { kind: 'complete-membership', parent: mapsScope },
  }
  const aggregate = {
    ref: project,
    integration: 'local',
    connectionId: 'local',
    source: { integration: 'local', path: '/fixture' },
    management: {},
    name: 'Configured Project',
    actions: [],
    managementWarnings: [],
    resource: { kind: 'current-readable', observation: projectObservation },
    mapsMembership: {
      kind: 'current-complete',
      observation: {
        scope: mapsScope,
        attemptedAt: 100,
        observedAt: 101,
        provenance: enumerate,
        completeness: { kind: 'complete' },
        value: { members: [map] },
      },
    },
    maps: [
      {
        ref: map,
        frontier: [ticket],
        resource: { kind: 'current-readable', observation: mapObservation },
        ticketsMembership: {
          kind: 'current-complete',
          observation: {
            scope: ticketsScope,
            attemptedAt: 100,
            observedAt: 101,
            provenance: { ...enumerate, path: '/fixture/tickets' },
            completeness: { kind: 'complete' },
            value: { members: [ticket] },
          },
        },
        tickets: [
          { ref: ticket, resource: { kind: 'current-readable', observation: ticketObservation } },
        ],
      },
    ],
    displayOrder: { open: [map], closed: [] },
    activeMap: { kind: 'known-current', ref: map },
  }
  return {
    projectScope,
    mapScope,
    ticketScope,
    projectObservation,
    mapObservation,
    ticketObservation,
    unavailable,
    absence,
    aggregate,
  }
}

function reboundResourceFixture() {
  const fixture = scopedResourceFixture()
  const project = { integration: 'github', projectId: 'opaque-rebound-project' }
  const map = { project, mapId: 'same/map' }
  const ticket = { map, ticketId: 'same/ticket' }
  const projectScope = { kind: 'project', project }
  const mapsScope = { kind: 'maps-membership', project }
  const ticketsScope = { kind: 'tickets-membership', map }
  const oldOwner = {
    integration: 'github',
    connectionId: 'former-connection',
    repositoryId: 'former-repository',
    stage: 'repository',
  }
  const newOwner = {
    ...oldOwner,
    connectionId: 'current-connection',
    repositoryId: 'current-repository',
  }
  const projectObservation = {
    ...fixture.projectObservation,
    scope: projectScope,
    provenance: oldOwner,
    value: {
      ...fixture.projectObservation.value,
      source: {
        integration: 'github',
        repositoryId: oldOwner.repositoryId,
        nameWithOwner: 'former/repo',
        url: 'https://github.com/former/repo',
      },
    },
  }
  const mapObservation = {
    ...fixture.mapObservation,
    scope: { kind: 'map', map },
    provenance: { ...oldOwner, stage: 'map-read' },
    value: {
      ...fixture.mapObservation.value,
      source: { kind: 'issue', url: 'https://github.com/former/repo/issues/1' },
    },
  }
  const ticketObservation = {
    ...fixture.ticketObservation,
    scope: { kind: 'ticket', ticket },
    provenance: { ...oldOwner, stage: 'map-read' },
    value: {
      ...fixture.ticketObservation.value,
      source: { kind: 'issue', url: 'https://github.com/former/repo/issues/2' },
    },
  }
  const mapsObservation = {
    ...fixture.aggregate.mapsMembership.observation,
    scope: mapsScope,
    provenance: { ...oldOwner, stage: 'map-list' },
    value: { members: [map] },
  }
  const ticketsObservation = {
    ...fixture.aggregate.mapsMembership.observation,
    scope: ticketsScope,
    provenance: { ...oldOwner, stage: 'map-read' },
    value: { members: [ticket] },
  }
  const unavailable = {
    kind: 'source-failure',
    scope: projectScope,
    attemptedAt: 200,
    provenance: newOwner,
    failure: { kind: 'access-ambiguous', evidence: 'missing-alias' },
    cause: 'GitHub source is inaccessible; absence is not proven.',
  }
  const aggregate = {
    ref: project,
    integration: 'github',
    connectionId: newOwner.connectionId,
    source: {
      integration: 'github',
      repositoryId: newOwner.repositoryId,
      nameWithOwner: 'current/repo',
      url: 'https://github.com/current/repo',
    },
    management: { workspacePath: '/fixture' },
    name: 'Configured Project',
    actions: [],
    managementWarnings: [],
    resource: { kind: 'retained-unavailable', lastSuccessful: projectObservation, unavailable },
    mapsMembership: { kind: 'unavailable', unavailable, lastComplete: mapsObservation },
    maps: [
      {
        ref: map,
        frontier: [ticket],
        resource: { kind: 'retained-unavailable', lastSuccessful: mapObservation, unavailable },
        ticketsMembership: { kind: 'unavailable', unavailable, lastComplete: ticketsObservation },
        tickets: [
          {
            ref: ticket,
            resource: {
              kind: 'retained-unavailable',
              lastSuccessful: ticketObservation,
              unavailable,
            },
          },
        ],
      },
    ],
    displayOrder: { open: [map], closed: [] },
    activeMap: {
      kind: 'uncertain',
      reason: 'project-unavailable',
      cause: 'Project source is currently unavailable.',
    },
  }
  const recovered = {
    ...aggregate,
    resource: {
      kind: 'current-readable',
      observation: {
        ...projectObservation,
        attemptedAt: 300,
        observedAt: 301,
        provenance: newOwner,
        value: {
          ...projectObservation.value,
          source: {
            integration: 'github',
            repositoryId: newOwner.repositoryId,
            nameWithOwner: 'current/repo',
            url: 'https://github.com/current/repo',
          },
        },
      },
    },
    activeMap: {
      kind: 'uncertain',
      reason: 'membership-unavailable',
      cause: 'Map membership is currently unavailable.',
    },
  }
  const registered = {
    ...aggregate,
    connectionId: newOwner.connectionId,
    integration: 'github',
    source: {
      integration: 'github',
      repositoryId: newOwner.repositoryId,
      nameWithOwner: 'current/repo',
      url: 'https://github.com/current/repo',
    },
    management: { workspacePath: '/fixture' },
    name: 'Configured Project',
    actions: [],
    managementWarnings: [],
  }
  const state = {
    ...applicationWithProgress(null),
    connections: [
      {
        id: newOwner.connectionId,
        integration: 'github',
        name: 'Current owner',
        builtIn: false,
        githubIdentity: { id: 'current-account', login: 'current-user' },
        availability: { status: 'available' },
      },
    ],
    projects: [registered],
    capturedAt: 400,
  }
  return {
    aggregate,
    recovered,
    registered,
    state,
    projectObservation,
    mapObservation,
    ticketObservation,
    mapsScope,
    oldOwner,
    newOwner,
  }
}

describe('retained resource public format', () => {
  test('never-observed resources carry no invented content or successful time', () => {
    const fixture = scopedResourceFixture()
    for (const { schema, scope } of [
      { schema: projectResourceSchema, scope: fixture.projectScope },
      { schema: mapResourceSchema, scope: fixture.mapScope },
      { schema: ticketResourceSchema, scope: fixture.ticketScope },
    ]) {
      const input = { kind: 'never-observed', scope, current: null }
      expect(schema.safeParse(input)).toMatchObject({ success: true, data: input })
      expect(schema.safeParse({ ...input, value: { body: 'Invented prose' } }).success).toBe(false)
      expect(schema.safeParse({ ...input, observedAt: 400 }).success).toBe(false)
    }
  })

  test('readable and retained phases require the actual own-scope payload', () => {
    const fixture = scopedResourceFixture()
    for (const { schema, observation } of [
      { schema: projectResourceSchema, observation: fixture.projectObservation },
      { schema: mapResourceSchema, observation: fixture.mapObservation },
      { schema: ticketResourceSchema, observation: fixture.ticketObservation },
    ]) {
      expect(schema.safeParse({ kind: 'current-readable', observation }).success).toBe(true)
      const unavailable = {
        kind: 'no-current-evidence',
        scope: observation.scope,
        cause: 'No current source observation is available.',
      }
      expect(
        schema.safeParse({ kind: 'retained-unavailable', lastSuccessful: observation, unavailable })
          .success,
      ).toBe(true)
      const { value: _value, ...metadata } = observation
      expect(schema.safeParse({ kind: 'current-readable', observation: metadata }).success).toBe(
        false,
      )
      expect(
        schema.safeParse({ kind: 'retained-unavailable', lastSuccessful: metadata, unavailable })
          .success,
      ).toBe(false)
    }
  })

  test('retained content keeps its real success time and actual failing ancestor provenance', () => {
    const fixture = scopedResourceFixture()
    const input = {
      kind: 'retained-unavailable',
      lastSuccessful: fixture.mapObservation,
      unavailable: fixture.unavailable,
    }
    const decoded = mapResourceSchema.safeParse(JSON.parse(JSON.stringify(input)))
    expect(decoded).toMatchObject({
      success: true,
      data: {
        lastSuccessful: {
          observedAt: 101,
          value: {
            body: { raw: 'Actual map prose' },
            source: { kind: 'file', path: '/fixture/map.md' },
          },
        },
        unavailable: {
          attemptedAt: 200,
          scope: { kind: 'maps-membership' },
          provenance: { path: '/fixture/maps', operation: 'enumerate' },
        },
      },
    })
    expect(
      mapResourceSchema.safeParse({
        ...input,
        unavailable: { ...fixture.unavailable, observedAt: 200 },
      }).success,
    ).toBe(false)
    expect(
      mapResourceSchema.safeParse({
        ...input,
        unavailable: { ...fixture.unavailable, cause: 'Raw secret exception' },
      }).success,
    ).toBe(false)
  })

  test('absence requires trustworthy proof and an explicit historical trace variant', () => {
    const fixture = scopedResourceFixture()
    const withTrace = {
      kind: 'proven-absent',
      absence: fixture.absence,
      trace: { kind: 'last-successful-trace', lastSuccessful: fixture.mapObservation },
    }
    expect(mapResourceSchema.safeParse(withTrace)).toMatchObject({ success: true, data: withTrace })
    expect(
      mapResourceSchema.safeParse({
        kind: 'proven-absent',
        absence: fixture.absence,
        trace: { kind: 'no-known-trace' },
      }).success,
    ).toBe(true)
    expect(
      mapResourceSchema.safeParse({ kind: 'proven-absent', absence: fixture.absence }).success,
    ).toBe(false)
    expect(
      mapResourceSchema.safeParse({ ...withTrace, trace: { kind: 'last-successful-trace' } })
        .success,
    ).toBe(false)
    expect(
      mapResourceSchema.safeParse({
        ...withTrace,
        absence: { ...fixture.absence, proof: { kind: 'http-404' } },
      }).success,
    ).toBe(false)
  })

  test('readable incomplete prose remains payload-bearing without fabricated progress', () => {
    const fixture = scopedResourceFixture()
    const observation = {
      ...fixture.mapObservation,
      completeness: { kind: 'incomplete', reason: 'malformed' },
      value: {
        ...fixture.mapObservation.value,
        progress: null,
        body: { ...fixture.mapObservation.value.body, missingSections: ['Notes'] },
        warnings: ['Readable source is incomplete.'],
      },
    }
    expect(mapResourceSchema.safeParse({ kind: 'current-readable', observation })).toMatchObject({
      success: true,
      data: {
        observation: {
          value: { progress: null, body: { raw: 'Actual map prose', missingSections: ['Notes'] } },
        },
      },
    })
  })

  test('outer scope and canonical membership reject cross-parent resource payloads', () => {
    const fixture = scopedResourceFixture()
    expect(projectSchema.safeParse(fixture.aggregate).success).toBe(true)
    const original = fixture.aggregate.maps[0]
    if (!original) throw new Error('Expected a real map resource fixture')
    expect(
      projectSchema.safeParse({
        ...fixture.aggregate,
        maps: [original, original],
      }).success,
    ).toBe(false)
    expect(
      projectSchema.safeParse({
        ...fixture.aggregate,
        maps: [
          {
            ...original,
            ref: { ...original.ref, project: { integration: 'local', projectId: 'wrong-parent' } },
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      projectSchema.safeParse({
        ...fixture.aggregate,
        displayOrder: {
          open: [{ project: fixture.aggregate.ref, mapId: 'unobserved-map' }],
          closed: [],
        },
      }).success,
    ).toBe(false)
  })

  test('retained ordering is not current active-map proof', () => {
    const fixture = scopedResourceFixture()
    const original = fixture.aggregate.maps[0]
    if (!original) throw new Error('Expected a real map resource fixture')
    const retained = {
      ...original,
      resource: {
        kind: 'retained-unavailable',
        lastSuccessful: fixture.mapObservation,
        unavailable: fixture.unavailable,
      },
      tickets: original.tickets.map((ticket) => ({
        ...ticket,
        resource: {
          kind: 'retained-unavailable',
          lastSuccessful: fixture.ticketObservation,
          unavailable: fixture.unavailable,
        },
      })),
    }
    expect(projectSchema.safeParse({ ...fixture.aggregate, maps: [retained] }).success).toBe(false)
    const activeMap = {
      kind: 'uncertain',
      reason: 'map-unavailable',
      cause: 'A map required for ordering is currently unavailable.',
    }
    expect(
      projectSchema.safeParse({
        ...fixture.aggregate,
        maps: [retained],
        activeMap,
      }).success,
    ).toBe(true)
    expect(activeMapSchema.safeParse({ ...activeMap, mapId: original.ref.mapId }).success).toBe(
      false,
    )
    expect(
      activeMapSchema.safeParse({ kind: 'known-empty', mapId: original.ref.mapId }).success,
    ).toBe(false)
  })

  test('new-owner failed baseline preserves old-owner successes and complete membership history', () => {
    const fixture = reboundResourceFixture()
    expect(projectSchema.safeParse(fixture.aggregate)).toMatchObject({
      success: true,
      data: fixture.aggregate,
    })
    const decoded = decodeApplicationState(JSON.parse(JSON.stringify(fixture.state)))
    expect(decoded).toEqual({ ok: true, value: fixture.state })
    expect(
      projectResourceSchema.safeParse({
        ...fixture.aggregate.resource,
        lastSuccessful: {
          ...fixture.projectObservation,
          value: {
            ...fixture.projectObservation.value,
            source: {
              ...fixture.projectObservation.value.source,
              repositoryId: 'unrelated-repository',
            },
          },
        },
      }).success,
    ).toBe(false)
  })

  test('current Project recovery can coexist with historical old-owner maps and tickets', () => {
    const fixture = reboundResourceFixture()
    const state = { ...fixture.state, projects: [{ ...fixture.registered, ...fixture.recovered }] }
    expect(projectSchema.safeParse(fixture.recovered)).toMatchObject({
      success: true,
      data: fixture.recovered,
    })
    expect(decodeApplicationState(JSON.parse(JSON.stringify(state)))).toEqual({
      ok: true,
      value: state,
    })
  })

  test('old-owner successful payload cannot masquerade as current evidence after rebind', () => {
    const fixture = reboundResourceFixture()
    const oldCurrentProject = { kind: 'current-readable', observation: fixture.projectObservation }
    expect(
      decodeApplicationState({
        ...fixture.state,
        projects: [{ ...fixture.registered, resource: oldCurrentProject }],
      }).ok,
    ).toBe(false)
    const original = fixture.recovered.maps[0]
    if (!original) throw new Error('Expected a retained map after owner rebind')
    const oldCurrentMap = {
      ...original,
      resource: { kind: 'current-readable', observation: fixture.mapObservation },
    }
    expect(projectSchema.safeParse({ ...fixture.recovered, maps: [oldCurrentMap] }).success).toBe(
      false,
    )
    expect(
      decodeApplicationState({
        ...fixture.state,
        projects: [{ ...fixture.registered, ...fixture.recovered, maps: [oldCurrentMap] }],
      }).ok,
    ).toBe(false)
    const recoveredObservation = fixture.recovered.resource.observation
    const formerConnection = {
      ...recoveredObservation,
      provenance: {
        ...recoveredObservation.provenance,
        connectionId: fixture.oldOwner.connectionId,
      },
    }
    expect(
      decodeApplicationState({
        ...fixture.state,
        projects: [
          {
            ...fixture.registered,
            ...fixture.recovered,
            resource: { kind: 'current-readable', observation: formerConnection },
          },
        ],
      }).ok,
    ).toBe(false)
  })

  test('old-owner absence remains historical and cannot prove current absence after source rebind', () => {
    const fixture = reboundResourceFixture()
    const original = fixture.aggregate.maps[0]
    if (!original) throw new Error('Expected a historical map after owner rebind')
    const absence = {
      scope: fixture.mapObservation.scope,
      attemptedAt: 150,
      observedAt: 151,
      provenance: { ...fixture.oldOwner, stage: 'map-list' },
      proof: { kind: 'complete-membership', parent: fixture.mapsScope },
    }
    const resource = {
      kind: 'proven-absent',
      absence,
      trace: { kind: 'last-successful-trace', lastSuccessful: fixture.mapObservation },
    }
    const aggregate = { ...fixture.aggregate, maps: [{ ...original, resource }] }
    const state = { ...fixture.state, projects: [{ ...fixture.registered, ...aggregate }] }
    expect(mapResourceSchema.safeParse(resource)).toMatchObject({ success: true, data: resource })
    expect(projectSchema.safeParse(aggregate).success).toBe(false)
    expect(decodeApplicationState(JSON.parse(JSON.stringify(state))).ok).toBe(false)
    const currentAbsence = {
      ...resource,
      absence: { ...absence, provenance: { ...fixture.newOwner, stage: 'map-list' } },
    }
    const currentProject = {
      ...fixture.aggregate,
      maps: [{ ...original, resource: currentAbsence }],
      displayOrder: { open: [], closed: [] },
    }
    expect(projectSchema.safeParse(currentProject)).toMatchObject({
      success: true,
      data: {
        maps: [
          {
            resource: {
              kind: 'proven-absent',
              absence: currentAbsence.absence,
              trace: { lastSuccessful: fixture.mapObservation },
            },
            tickets: [{ resource: { lastSuccessful: fixture.ticketObservation } }],
          },
        ],
      },
    })
    const currentState = { ...fixture.state, projects: [currentProject] }
    expect(decodeApplicationState(JSON.parse(JSON.stringify(currentState)))).toEqual({
      ok: true,
      value: currentState,
    })
    expect(projectSchema.safeParse(fixture.aggregate)).toMatchObject({
      success: true,
      data: {
        resource: { lastSuccessful: fixture.projectObservation },
        mapsMembership: { lastComplete: fixture.aggregate.mapsMembership.lastComplete },
        maps: [
          {
            resource: { kind: 'retained-unavailable', lastSuccessful: fixture.mapObservation },
            ticketsMembership: { lastComplete: original.ticketsMembership.lastComplete },
            tickets: [{ resource: { lastSuccessful: fixture.ticketObservation } }],
          },
        ],
      },
    })
    expect(
      mapResourceSchema.safeParse({
        ...resource,
        absence: {
          ...absence,
          proof: {
            kind: 'complete-membership',
            parent: {
              ...fixture.mapsScope,
              project: { ...fixture.aggregate.ref, projectId: 'wrong-parent' },
            },
          },
        },
      }).success,
    ).toBe(false)
  })

  test('historical deletion proof and successful trace validate their own different owners', () => {
    const fixture = reboundResourceFixture()
    const absence = {
      scope: fixture.projectObservation.scope,
      attemptedAt: 150,
      observedAt: 151,
      provenance: fixture.oldOwner,
      proof: { kind: 'provider-deletion', repositoryId: fixture.oldOwner.repositoryId },
    }
    const earlierSuccess = {
      ...fixture.projectObservation,
      provenance: {
        ...fixture.oldOwner,
        connectionId: 'earlier-connection',
        repositoryId: 'earlier-repository',
      },
      value: {
        ...fixture.projectObservation.value,
        source: { ...fixture.projectObservation.value.source, repositoryId: 'earlier-repository' },
      },
    }
    const resource = {
      kind: 'proven-absent',
      absence,
      trace: { kind: 'last-successful-trace', lastSuccessful: earlierSuccess },
    }
    expect(projectResourceSchema.safeParse(resource)).toMatchObject({
      success: true,
      data: resource,
    })
    expect(
      projectResourceSchema.safeParse({
        ...resource,
        absence: {
          ...absence,
          proof: { kind: 'provider-deletion', repositoryId: fixture.newOwner.repositoryId },
        },
      }).success,
    ).toBe(false)
  })

  test('actual successful child reads remain readable under failed parents without active certainty', () => {
    const fixture = scopedResourceFixture()
    const original = fixture.aggregate.maps[0]
    if (!original) throw new Error('Expected independently scoped map and ticket fixtures')
    const originalTicket = original.tickets[0]
    if (!originalTicket) throw new Error('Expected an independently read ticket fixture')
    const mapFailure = {
      ...fixture.unavailable,
      scope: fixture.mapScope,
      provenance: fixture.mapObservation.provenance,
      failure: { kind: 'filesystem', operation: 'read', code: 'EACCES' },
    }
    const child = {
      kind: 'current-readable',
      observation: { ...fixture.ticketObservation, attemptedAt: 200, observedAt: 201 },
    }
    const aggregate = {
      ...fixture.aggregate,
      maps: [
        {
          ...original,
          resource: {
            kind: 'retained-unavailable',
            lastSuccessful: fixture.mapObservation,
            unavailable: mapFailure,
          },
          tickets: [{ ref: originalTicket.ref, resource: child }],
        },
      ],
      activeMap: {
        kind: 'uncertain',
        reason: 'map-unavailable',
        cause: 'A map required for ordering is currently unavailable.',
      },
    }
    expect(projectSchema.safeParse(aggregate)).toMatchObject({
      success: true,
      data: aggregate,
    })
    expect(
      projectSchema.safeParse({
        ...aggregate,
        activeMap: fixture.aggregate.activeMap,
      }).success,
    ).toBe(false)
    const retainedMap = aggregate.maps[0]
    if (!retainedMap) throw new Error('Expected retained map with independently successful child')
    const historical = {
      ...aggregate,
      maps: [
        {
          ...retainedMap,
          tickets: [
            {
              ref: originalTicket.ref,
              resource: {
                kind: 'retained-unavailable',
                lastSuccessful: fixture.ticketObservation,
                unavailable: mapFailure,
              },
            },
          ],
        },
      ],
    }
    expect(projectSchema.safeParse(historical)).toMatchObject({
      success: true,
      data: historical,
    })
  })

  test('Local path rebind retains former path history but rejects it as current authority', () => {
    const fixture = scopedResourceFixture()
    const original = fixture.aggregate.maps[0]
    if (!original) throw new Error('Expected a Local map resource fixture')
    const unavailable = {
      kind: 'source-failure',
      scope: fixture.projectScope,
      attemptedAt: 200,
      provenance: { integration: 'local', path: '/rebound', operation: 'inspect-root' },
      failure: { kind: 'filesystem', operation: 'inspect-root', code: 'EACCES' },
      cause: 'Workspace read permission was denied.',
    }
    const aggregate = {
      ...fixture.aggregate,
      source: { integration: 'local', path: '/rebound' },
      resource: {
        kind: 'retained-unavailable',
        lastSuccessful: fixture.projectObservation,
        unavailable,
      },
      mapsMembership: {
        kind: 'unavailable',
        unavailable,
        lastComplete: fixture.aggregate.mapsMembership.observation,
      },
      maps: [
        {
          ...original,
          resource: {
            kind: 'retained-unavailable',
            lastSuccessful: fixture.mapObservation,
            unavailable,
          },
          ticketsMembership: {
            kind: 'unavailable',
            unavailable,
            lastComplete: original.ticketsMembership.observation,
          },
          tickets: original.tickets.map((entry) => ({
            ...entry,
            resource: {
              kind: 'retained-unavailable',
              lastSuccessful: fixture.ticketObservation,
              unavailable,
            },
          })),
        },
      ],
      activeMap: {
        kind: 'uncertain',
        reason: 'project-unavailable',
        cause: 'Project source is currently unavailable.',
      },
    }
    const registered = {
      ...aggregate,
      connectionId: 'local',
      source: { integration: 'local', path: '/rebound' },
      integration: 'local',
      management: {},
      name: 'Configured Project',
      actions: [],
      managementWarnings: [],
    }
    const input = {
      ...applicationWithProgress(null),
      connections: [
        {
          id: 'local',
          integration: 'local',
          name: 'Local',
          builtIn: true,
          availability: { status: 'available' },
        },
      ],
      projects: [registered],
      capturedAt: 400,
    }
    expect(projectSchema.safeParse(aggregate)).toMatchObject({
      success: true,
      data: aggregate,
    })
    expect(decodeApplicationState(JSON.parse(JSON.stringify(input)))).toEqual({
      ok: true,
      value: input,
    })
    expect(
      decodeApplicationState({
        ...input,
        projects: [
          {
            ...registered,
            resource: { kind: 'current-readable', observation: fixture.projectObservation },
          },
        ],
      }).ok,
    ).toBe(false)
  })

  test('the actual application decoder accepts only one resource payload collection', () => {
    const fixture = scopedResourceFixture()
    const input = {
      ...applicationWithProgress(null),
      connections: [
        {
          id: 'local',
          integration: 'local',
          name: 'Local',
          builtIn: true,
          availability: { status: 'available' },
        },
      ],
      projects: [
        {
          ...fixture.aggregate,
          connectionId: 'local',
          source: { integration: 'local', path: '/fixture' },
          integration: 'local',
          management: {},
          name: 'Configured Project',
          actions: [],
          managementWarnings: [],
        },
      ],
      capturedAt: 400,
    }
    const decoded = decodeApplicationState(JSON.parse(JSON.stringify(input)))
    expect(decoded).toEqual({ ok: true, value: input })
    expect(
      decodeApplicationState({ ...input, roadmap: { capturedAt: 400, projects: [] } }).ok,
    ).toBe(false)
    const registered = input.projects[0]
    if (!registered) throw new Error('Expected a registered Project resource fixture')
    expect(
      decodeApplicationState({
        ...input,
        projects: [{ ...registered, accessToken: 'throwaway-not-a-credential' }],
      }).ok,
    ).toBe(false)
  })
})
