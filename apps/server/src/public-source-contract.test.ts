import { decodeApplicationState } from '@roadmap/contracts/wire'
import { describe, expect, test } from 'vitest'
import { ticketTypeEvidenceFromLabels } from './wayfinder/tickets.ts'

function githubState(typeEvidence: unknown = { kind: 'missing', labels: [] }) {
  const projectRef = { integration: 'github', projectId: 'opaque/project' }
  const mapRef = { project: structuredClone(projectRef), mapId: '1' }
  const ticketRef = { map: structuredClone(mapRef), ticketId: '2' }
  const source = {
    integration: 'github',
    repositoryId: '42',
    nameWithOwner: 'owner/repo',
    url: 'https://github.com/owner/repo',
  }
  function metadata(stage: string) {
    return {
      attemptedAt: 1,
      observedAt: 1,
      provenance: { integration: 'github', connectionId: 'github', repositoryId: '42', stage },
      completeness: { kind: 'complete' },
    }
  }
  const ticket = {
    ref: structuredClone(ticketRef),
    resource: {
      kind: 'current-readable',
      observation: {
        ...metadata('map-read'),
        scope: { kind: 'ticket', ticket: structuredClone(ticketRef) },
        value: {
          source: { kind: 'issue', url: 'https://github.com/owner/repo/issues/2' },
          status: 'open',
          body: 'Actual ticket prose.',
          typeEvidence: structuredClone(typeEvidence),
          state: 'frontier',
          isClaimed: false,
          isBlocked: false,
          assignees: [],
          blockedBy: [],
          blockersComplete: true,
          warnings: [],
        },
      },
    },
  }
  const map = {
    ref: structuredClone(mapRef),
    resource: {
      kind: 'current-readable',
      observation: {
        ...metadata('map-read'),
        scope: { kind: 'map', map: structuredClone(mapRef) },
        value: {
          source: { kind: 'issue', url: 'https://github.com/owner/repo/issues/1' },
          status: 'open',
          updatedAt: 1,
          body: {
            raw: '# Map',
            destination: '',
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
      },
    },
    ticketsMembership: {
      kind: 'current-complete',
      observation: {
        ...metadata('map-read'),
        scope: { kind: 'tickets-membership', map: structuredClone(mapRef) },
        value: { members: [structuredClone(ticketRef)] },
      },
    },
    tickets: [ticket],
    frontier: [structuredClone(ticketRef)],
  }
  const project = {
    integration: 'github',
    ref: structuredClone(projectRef),
    connectionId: 'github',
    source: structuredClone(source),
    management: { workspacePath: '/fixture' },
    name: 'owner/repo',
    actions: [],
    managementWarnings: [],
    resource: {
      kind: 'current-readable',
      observation: {
        ...metadata('repository'),
        scope: { kind: 'project', project: structuredClone(projectRef) },
        value: { name: 'owner/repo', source: structuredClone(source), warnings: [] },
      },
    },
    mapsMembership: {
      kind: 'current-complete',
      observation: {
        ...metadata('map-list'),
        scope: { kind: 'maps-membership', project: structuredClone(projectRef) },
        value: { members: [structuredClone(mapRef)] },
      },
    },
    maps: [map],
    displayOrder: { open: [structuredClone(mapRef)], closed: [] },
    activeMap: { kind: 'known-current', ref: structuredClone(mapRef) },
  }
  return {
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: 'source-contract',
    stateSequence: 0,
    capturedAt: 2,
    configurationVersion: 0,
    supportedIntegrations: [],
    connections: [
      {
        id: 'github',
        integration: 'github',
        builtIn: false,
        name: 'GitHub',
        githubIdentity: { id: '123', login: 'owner' },
        availability: { status: 'available' },
      },
    ],
    projects: [project],
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

function githubFixture(typeEvidence?: unknown) {
  const state = githubState(typeEvidence)
  const project = state.projects[0]
  if (!project) throw new Error('Fixture requires a Project.')
  return { state, project }
}

function localFixture() {
  const ref = { integration: 'local', projectId: 'opaque/local' }
  const project = {
    integration: 'local',
    ref: structuredClone(ref),
    connectionId: 'local',
    source: { integration: 'local', path: '/current' },
    management: {},
    name: 'Local project',
    actions: [],
    managementWarnings: [],
    resource: {
      kind: 'current-readable',
      observation: {
        scope: { kind: 'project', project: structuredClone(ref) },
        attemptedAt: 1,
        observedAt: 1,
        provenance: { integration: 'local', path: '/current', operation: 'inspect-root' },
        completeness: { kind: 'complete' },
        value: {
          name: 'Local project',
          source: { integration: 'local', path: '/current' },
          warnings: [],
        },
      },
    },
    mapsMembership: {
      kind: 'current-complete',
      observation: {
        scope: { kind: 'maps-membership', project: structuredClone(ref) },
        attemptedAt: 1,
        observedAt: 1,
        provenance: { integration: 'local', path: '/current', operation: 'enumerate' },
        completeness: { kind: 'complete' },
        value: { members: [] },
      },
    },
    maps: [],
    displayOrder: { open: [], closed: [] },
    activeMap: { kind: 'known-empty' },
  }
  const state = {
    ...githubState(),
    connections: [
      {
        id: 'local',
        integration: 'local',
        builtIn: true,
        name: 'Local',
        availability: { status: 'available' },
      },
    ],
    projects: [project],
  }
  return { state, project }
}

function accepted(input: unknown) {
  expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
}

function refused(input: unknown, path: string) {
  const result = decodeApplicationState(input)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected whole-state refusal.')
  expect(result.issues.some((issue) => issue.path.includes(path))).toBe(true)
}

describe('source facts at the whole-state boundary', () => {
  test('accepts independently owned current source observations', () => {
    accepted(githubState())
    accepted(localFixture().state)
  })

  test.each([
    { labels: [' WAYFINDER: Task  '], expected: { kind: 'unknown', labels: [' task'] } },
    {
      labels: ['wayfinder:task', ' Wayfinder: Task ', 'wayfinder:task'],
      expected: { kind: 'conflicting', labels: [' task', 'task'] },
    },
  ])(
    'preserves malformed suffix whitespace as actual unknown or conflicting evidence %#',
    ({ labels, expected }) => {
      const evidence = ticketTypeEvidenceFromLabels(labels)
      expect(evidence).toEqual(expected)
      accepted(githubState(evidence))
    },
  )

  test.each([
    { kind: 'unknown', labels: ['task '] },
    { kind: 'unknown', labels: [' Task'] },
    { kind: 'conflicting', labels: ['task', ' task'] },
  ])(
    'refuses suffix evidence inconsistent with whole-label normalization or source order %#',
    (evidence) => {
      refused(githubState(evidence), 'labels')
    },
  )

  test.each(['', 'data:text/html,unsafe', 'javascript:alert(1)', '//other.example/repo'])(
    'refuses unsafe Project source destination %s',
    (url) => {
      const { state, project } = githubFixture()
      project.source.url = url
      project.resource.observation.value.source.url = url
      refused(state, 'source')
    },
  )

  test.each(['', 'data:text/html,unsafe', 'javascript:alert(1)', '//other.example/issue'])(
    'refuses unsafe actual map and ticket source destinations %s',
    (url) => {
      for (const destination of ['map', 'ticket']) {
        const { state, project } = githubFixture()
        const map = project.maps[0]
        const ticket = map?.tickets[0]
        if (!map || !ticket) throw new Error('Fixture requires a map and ticket.')
        const source =
          destination === 'map'
            ? map.resource.observation.value.source
            : ticket.resource.observation.value.source
        source.url = url
        refused(state, 'source')
      }
    },
  )

  test.each(['', 'data:text/html,unsafe', 'javascript:alert(1)', '//other.example/repo'])(
    'refuses unsafe retained repository source destination %s',
    (url) => {
      const { state, project } = githubFixture()
      const lastSuccessful = structuredClone(project.resource.observation)
      lastSuccessful.value.source.url = url
      Reflect.set(project, 'resource', {
        kind: 'retained-unavailable',
        lastSuccessful,
        unavailable: {
          kind: 'no-current-evidence',
          scope: structuredClone(lastSuccessful.scope),
          cause: 'No current source observation is available.',
        },
      })
      Reflect.set(project, 'activeMap', {
        kind: 'uncertain',
        reason: 'project-unavailable',
        cause: 'Project source is currently unavailable.',
      })
      refused(state, 'source')
    },
  )

  test.each(['', 'data:text/html,unsafe', 'javascript:alert(1)', '//other.example/issue'])(
    'refuses unsafe optional external blocker destination %s',
    (url) => {
      const { state, project } = githubFixture()
      const ticket = project.maps[0]?.tickets[0]
      if (!ticket) throw new Error('Fixture requires a ticket.')
      const blocker: unknown = {
        reference: {
          kind: 'external',
          integration: 'github',
          nameWithOwner: 'other/repo',
          ticketId: '7',
        },
        state: 'closed',
        url,
      }
      Reflect.set(ticket.resource.observation.value, 'blockedBy', [blocker])
      refused(state, 'blockedBy')
    },
  )

  test.each([
    {
      reference: {
        kind: 'external',
        integration: 'github',
        nameWithOwner: 'other/repo',
        ticketId: '7',
      },
      state: 'closed',
    },
    { reference: { kind: 'unresolved', locator: 'previous/repo', ticketId: '7' }, state: 'closed' },
    {
      reference: {
        kind: 'external',
        integration: 'github',
        nameWithOwner: 'other/repo',
        ticketId: '7',
      },
      state: 'closed',
      url: 'https://github.com/other/repo/issues/7',
    },
    {
      reference: {
        kind: 'external',
        integration: 'github',
        nameWithOwner: 'other/repo',
        ticketId: '7',
      },
      state: 'closed',
      url: '/repositories/42/issues/7',
    },
  ])(
    'preserves optional absent blocker destinations and actual safe links %#',
    (blocker: unknown) => {
      const { state, project } = githubFixture()
      const ticket = project.maps[0]?.tickets[0]
      if (!ticket) throw new Error('Fixture requires a ticket.')
      Reflect.set(ticket.resource.observation.value, 'blockedBy', [structuredClone(blocker)])
      accepted(state)
    },
  )

  test.each(['https://github.com/owner/repo', 'http://example.test/repo', '/repositories/42'])(
    'accepts the existing shared safe destination policy %s',
    (url) => {
      const { state, project } = githubFixture()
      project.source.url = url
      project.resource.observation.value.source.url = url
      const map = project.maps[0]
      const ticket = map?.tickets[0]
      if (!map || !ticket) throw new Error('Fixture requires a map and ticket.')
      map.resource.observation.value.source.url = url
      ticket.resource.observation.value.source.url = url
      accepted(state)
    },
  )

  test.each([
    { nameWithOwner: 'old-owner/old-repo' },
    { url: 'https://github.com/old-owner/old-repo' },
    { repositoryId: 'different' },
  ])('refuses current observed source contradiction %#', (change) => {
    const { state, project } = githubFixture()
    Object.assign(project.resource.observation.value.source, change)
    if (change.repositoryId)
      project.resource.observation.provenance.repositoryId = change.repositoryId
    refused(state, 'resource')
  })

  test('accepts actual current repository rename with stable repository identity', () => {
    const { state, project } = githubFixture()
    project.source.nameWithOwner = 'new-owner/new-repo'
    project.source.url = 'https://github.com/new-owner/new-repo'
    project.resource.observation.value.source = structuredClone(project.source)
    project.resource.observation.value.name = 'new-owner/new-repo'
    accepted(state)
  })

  test.each(['retained-unavailable', 'proven-absent'])(
    'preserves previous repository locator in %s',
    (kind) => {
      const { state, project } = githubFixture()
      const lastSuccessful = structuredClone(project.resource.observation)
      project.source.nameWithOwner = 'new-owner/new-repo'
      project.source.url = 'https://github.com/new-owner/new-repo'
      const resource =
        kind === 'retained-unavailable'
          ? {
              kind,
              lastSuccessful,
              unavailable: {
                kind: 'no-current-evidence',
                scope: structuredClone(lastSuccessful.scope),
                cause: 'No current source observation is available.',
              },
            }
          : {
              kind,
              absence: {
                scope: structuredClone(lastSuccessful.scope),
                attemptedAt: 2,
                observedAt: 2,
                provenance: structuredClone(lastSuccessful.provenance),
                proof: { kind: 'provider-deletion', repositoryId: '42' },
              },
              trace: { kind: 'last-successful-trace', lastSuccessful },
            }
      Reflect.set(project, 'resource', resource)
      Reflect.set(project, 'activeMap', {
        kind: 'uncertain',
        reason: 'project-unavailable',
        cause: 'Project source is currently unavailable.',
      })
      accepted(state)
    },
  )

  test('refuses a current Local observation from a previous configured path', () => {
    const { state, project } = localFixture()
    project.resource.observation.value.source.path = '/previous'
    project.resource.observation.provenance.path = '/previous'
    refused(state, 'resource')
  })

  test('preserves previous Local path in retained source metadata', () => {
    const { state, project } = localFixture()
    const lastSuccessful = structuredClone(project.resource.observation)
    lastSuccessful.value.source.path = '/previous'
    lastSuccessful.provenance.path = '/previous'
    Reflect.set(project, 'resource', {
      kind: 'retained-unavailable',
      lastSuccessful,
      unavailable: {
        kind: 'no-current-evidence',
        scope: structuredClone(lastSuccessful.scope),
        cause: 'No current source observation is available.',
      },
    })
    Reflect.set(project, 'activeMap', {
      kind: 'uncertain',
      reason: 'project-unavailable',
      cause: 'Project source is currently unavailable.',
    })
    accepted(state)
  })

  describe('absence proof binding', () => {
    test.each(['project', 'map', 'ticket'])(
      'rejects wrong GitHub Connection or repository on %s absence',
      (target) => {
        for (const change of [{ connectionId: 'other-connection' }, { repositoryId: '999' }]) {
          const { state, project } = githubFixture()
          const map = project.maps[0]
          const ticket = map?.tickets[0]
          if (!map || !ticket) throw new Error('Fixture requires a map and ticket.')
          const owner = target === 'project' ? project : target === 'map' ? map : ticket
          const observation = owner.resource.observation
          const provenance = { ...observation.provenance, ...change }
          const proof =
            target === 'project'
              ? { kind: 'provider-deletion', repositoryId: provenance.repositoryId }
              : {
                  kind: 'complete-membership',
                  parent: structuredClone(
                    target === 'map'
                      ? project.mapsMembership.observation.scope
                      : map.ticketsMembership.observation.scope,
                  ),
                }
          Reflect.set(owner, 'resource', {
            kind: 'proven-absent',
            absence: {
              scope: structuredClone(observation.scope),
              attemptedAt: 2,
              observedAt: 2,
              provenance,
              proof,
            },
            trace: { kind: 'no-known-trace' },
          })
          if (target === 'map') project.mapsMembership.observation.value.members = []
          if (target === 'ticket') {
            map.ticketsMembership.observation.value.members = []
            map.frontier = []
          }
          Reflect.set(project, 'activeMap', {
            kind: 'uncertain',
            reason: 'project-unavailable',
            cause: 'Project source is currently unavailable.',
          })
          refused(state, 'resource')
        }
      },
    )

    test.each(['map', 'ticket'])('rejects an out-of-root Local path on %s absence', (target) => {
      const { state, project } = localFixture()
      const mapRef = { project: structuredClone(project.ref), mapId: '1' }
      const ticketRef = { map: structuredClone(mapRef), ticketId: '2' }
      const absence = {
        scope:
          target === 'map'
            ? { kind: 'map', map: structuredClone(mapRef) }
            : { kind: 'ticket', ticket: structuredClone(ticketRef) },
        attemptedAt: 2,
        observedAt: 2,
        provenance: { integration: 'local', path: '/current-other/1', operation: 'enumerate' },
        proof: {
          kind: 'complete-membership',
          parent:
            target === 'map'
              ? { kind: 'maps-membership', project: structuredClone(project.ref) }
              : { kind: 'tickets-membership', map: structuredClone(mapRef) },
        },
      }
      const map = {
        ref: mapRef,
        resource:
          target === 'map'
            ? { kind: 'proven-absent', absence, trace: { kind: 'no-known-trace' } }
            : {
                kind: 'never-observed',
                scope: { kind: 'map', map: structuredClone(mapRef) },
                current: null,
              },
        ticketsMembership: { kind: 'never-observed', current: null },
        tickets:
          target === 'ticket'
            ? [
                {
                  ref: ticketRef,
                  resource: { kind: 'proven-absent', absence, trace: { kind: 'no-known-trace' } },
                },
              ]
            : [],
        frontier: [],
      }
      Reflect.set(project, 'maps', [map])
      Reflect.set(project, 'mapsMembership', { kind: 'never-observed', current: null })
      Reflect.set(project, 'activeMap', {
        kind: 'uncertain',
        reason: 'membership-unavailable',
        cause: 'Map membership is currently unavailable.',
      })
      absence.provenance.path = '/current/1'
      accepted(state)
      absence.provenance.path = '/current-other/1'
      refused(state, 'resource')
      absence.provenance.path = '/current/1'
      const historicalMap = githubFixture().project.maps[0]
      const historicalTicket = historicalMap?.tickets[0]
      if (!historicalMap || !historicalTicket)
        throw new Error('Fixture requires historical content.')
      const lastSuccessful = structuredClone(
        target === 'map'
          ? historicalMap.resource.observation
          : historicalTicket.resource.observation,
      )
      Reflect.set(lastSuccessful, 'scope', structuredClone(absence.scope))
      Reflect.set(lastSuccessful, 'provenance', {
        integration: 'local',
        path: '/previous/1',
        operation: 'read',
      })
      Reflect.set(lastSuccessful.value, 'source', { kind: 'file', path: '/previous/1' })
      const resource = {
        kind: 'proven-absent',
        absence,
        trace: { kind: 'last-successful-trace', lastSuccessful },
      }
      if (target === 'map') Reflect.set(map, 'resource', resource)
      else {
        const ticket = map.tickets[0]
        if (!ticket) throw new Error('Fixture requires an absent ticket.')
        Reflect.set(ticket, 'resource', resource)
        Reflect.set(map, 'frontier', [structuredClone(ticketRef)])
      }
      accepted(state)
    })

    test.each(['project', 'map', 'ticket'])(
      'retains valid %s absence with a historical repository binding',
      (target) => {
        const { state, project } = githubFixture()
        const map = project.maps[0]
        const ticket = map?.tickets[0]
        if (!map || !ticket) throw new Error('Fixture requires a map and ticket.')
        const owner = target === 'project' ? project : target === 'map' ? map : ticket
        const observation = owner.resource.observation
        const lastSuccessful = structuredClone(observation)
        lastSuccessful.provenance.connectionId = 'previous-connection'
        lastSuccessful.provenance.repositoryId = '999'
        if (target === 'project') {
          const previous = structuredClone(project.resource.observation)
          previous.provenance = structuredClone(lastSuccessful.provenance)
          previous.value.source = {
            integration: 'github',
            repositoryId: '999',
            nameWithOwner: 'previous/repo',
            url: 'https://github.com/previous/repo',
          }
          Reflect.set(lastSuccessful, 'value', previous.value)
        } else
          Reflect.set(lastSuccessful.value, 'source', {
            kind: 'issue',
            url: 'https://github.com/previous/repo/issues/1',
          })
        const proof =
          target === 'project'
            ? { kind: 'provider-deletion', repositoryId: '42' }
            : {
                kind: 'complete-membership',
                parent: structuredClone(
                  target === 'map'
                    ? project.mapsMembership.observation.scope
                    : map.ticketsMembership.observation.scope,
                ),
              }
        Reflect.set(owner, 'resource', {
          kind: 'proven-absent',
          absence: {
            scope: structuredClone(observation.scope),
            attemptedAt: 2,
            observedAt: 2,
            provenance: structuredClone(observation.provenance),
            proof,
          },
          trace: { kind: 'last-successful-trace', lastSuccessful },
        })
        if (target === 'map') project.mapsMembership.observation.value.members = []
        if (target === 'ticket') {
          map.ticketsMembership.observation.value.members = []
          map.frontier = [structuredClone(ticket.ref)]
        }
        Reflect.set(project, 'activeMap', {
          kind: 'uncertain',
          reason: 'project-unavailable',
          cause: 'Project source is currently unavailable.',
        })
        accepted(state)
      },
    )
  })
})
