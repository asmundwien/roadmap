import {
  authorizationOperationIdSchema,
  connectionIdSchema,
  mapRefSchema,
  projectRefSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import type { MapResource, TicketResource, TicketResourceValue } from '@roadmap/contracts/state'
import { describe, expect, it } from 'vitest'
import { makeApplicationState } from '@/views/map/test-fixtures'
import {
  absentMap,
  currentProject,
  neverReadProject,
  readableMap,
  readableTicket,
} from '@/views/overview/test-fixtures'
import {
  presentAutomation,
  presentBlockerResource,
  presentProjects,
  resolveAuthorization,
  resolveConnection,
  resolveProject,
  resolveSelection,
  resourceObservation,
} from './results'

const project = projectRefSchema.parse({ integration: 'local', projectId: 'project-home' })
const mapRef = mapRefSchema.parse({ project, mapId: 'missing / %2F' })
const target = ticketRefSchema.parse({ map: mapRef, ticketId: 'same' })
const classification = {
  status: 'completed',
  admission: 'automatic',
  processResult: { status: 'exited', code: 7 },
  verdict: { value: 'afk', reason: 'Can run unattended.' },
} as const

function populateMap(map: MapResource, tickets: TicketResource[]) {
  if (map.resource.kind !== 'current-readable' || map.ticketsMembership.kind !== 'current-complete')
    throw new Error('Expected complete readable map fixture')
  map.tickets = tickets
  map.ticketsMembership.observation.value.members = tickets.map((ticket) => ticket.ref)
  map.frontier = tickets.flatMap((ticket) => {
    const observation = resourceObservation(ticket.resource)
    return observation !== null &&
      observation.completeness.kind === 'complete' &&
      observation.value.status === 'open' &&
      !observation.value.isClaimed &&
      observation.value.blockersComplete &&
      observation.value.blockedBy.every((blocker) => blocker.state === 'closed')
      ? [ticket.ref]
      : []
  })
  map.resource.observation.value.progress = {
    total: tickets.length,
    completed: tickets.filter(
      (ticket) => resourceObservation(ticket.resource)?.value.status === 'closed',
    ).length,
  }
  if (
    tickets.some(
      (ticket) =>
        ticket.resource.kind !== 'current-readable' ||
        !ticket.resource.observation.value.blockersComplete ||
        ticket.resource.observation.value.blockedBy.some((blocker) => blocker.state === 'unknown'),
    )
  ) {
    map.resource.observation.completeness = {
      kind: 'incomplete',
      reason: 'unreadable',
    }
  }
}

describe('shared resource results', () => {
  it.each<{
    evidence: TicketResourceValue['typeEvidence']
    type: string
    label: string
  }>([
    {
      evidence: { kind: 'recognized', value: 'task', labels: ['task'] },
      type: 'task',
      label: 'task',
    },
    { evidence: { kind: 'missing', labels: [] }, type: 'untyped', label: 'Type missing' },
    {
      evidence: { kind: 'unknown', labels: ['custom'] },
      type: 'untyped',
      label: 'Unknown type: custom',
    },
    {
      evidence: { kind: 'conflicting', labels: ['research', 'task'] },
      type: 'untyped',
      label: 'Conflicting types: research, task',
    },
  ])(
    'preserves $evidence.kind type evidence separately from its glyph',
    ({ evidence, type, label }) => {
      const map = readableMap(project, 'types')
      const ticket = readableTicket(map, 'typed')
      if (ticket.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
      ticket.resource.observation.value.typeEvidence = evidence
      populateMap(map, [ticket])
      const selected = resolveSelection(
        makeApplicationState([currentProject(project.projectId, [map])]),
        {
          project,
          map: map.ref,
          ticket: ticket.ref,
        },
      )
      expect(selected.ticket?.tracker).toMatchObject({
        type,
        typeLabel: label,
        blockedLabel: null,
        claimedLabel: null,
      })
    },
  )

  it('keeps closed placement independent of blocked and claimed badges', () => {
    const map = readableMap(project, 'closed-facts')
    const ticket = readableTicket(map, 'closed')
    if (ticket.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
    ticket.resource.observation.value = {
      ...ticket.resource.observation.value,
      status: 'closed',
      state: 'closed',
      isBlocked: true,
      isClaimed: true,
      blockedBy: [{ reference: { kind: 'registered', ticket: target }, state: 'unknown' }],
    }
    populateMap(map, [ticket])
    const selected = resolveSelection(
      makeApplicationState([currentProject(project.projectId, [map])]),
      {
        project,
        map: map.ref,
        ticket: ticket.ref,
      },
    )
    expect(selected.ticket?.tracker).toMatchObject({
      state: 'closed',
      label: 'Decided',
      isBlocked: true,
      isClaimed: true,
      blockedLabel: 'Blocked',
      claimedLabel: 'Claimed',
    })
  })

  it('distinguishes cross-map registered blockers and honors graph adapter scope', () => {
    const current = readableMap(project, 'current')
    const other = readableMap(project, 'other')
    const dependent = readableTicket(current, 'dependent')
    const outside = readableTicket(other, 'outside')
    const missing = ticketRefSchema.parse({ map: current.ref, ticketId: 'missing' })
    if (dependent.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
    dependent.resource.observation.value = {
      ...dependent.resource.observation.value,
      state: 'blocked',
      isBlocked: true,
      blockedBy: [
        { reference: { kind: 'registered', ticket: outside.ref }, state: 'open' },
        { reference: { kind: 'registered', ticket: missing }, state: 'unknown' },
      ],
    }
    populateMap(current, [dependent])
    populateMap(other, [outside])
    const selected = resolveSelection(
      makeApplicationState([currentProject(project.projectId, [current, other])]),
      {
        project,
        map: current.ref,
        ticket: dependent.ref,
      },
    )
    expect(selected.ticket?.blockers).toMatchObject([
      { local: false, scopeLabel: 'Registered outside map', tracker: { state: 'frontier' } },
      { local: true, scopeLabel: 'Missing from map', tracker: null },
    ])
    expect(
      presentBlockerResource(
        {
          reference: { kind: 'registered', ticket: outside.ref },
          state: 'closed',
          title: 'Merged title',
        },
        current.ref,
        { scope: 'external', target: selected.ticket?.blockers[0] },
      ),
    ).toMatchObject({
      title: 'Merged title',
      state: 'closed',
      graphStateLabel: 'Closed blocker',
      scopeLabel: 'Registered outside map',
      tracker: { state: 'frontier' },
    })
    expect(
      presentBlockerResource(
        { reference: { kind: 'registered', ticket: missing }, state: 'open' },
        current.ref,
        { scope: 'external' },
      ).scopeLabel,
    ).toBe('Registered outside map')
  })

  it('keeps unknown blocker facts beside retained target availability', () => {
    const map = readableMap(project, 'retained-blocker')
    const dependent = readableTicket(map, 'dependent')
    const retained = readableTicket(map, 'retained')
    if (
      dependent.resource.kind !== 'current-readable' ||
      retained.resource.kind !== 'current-readable'
    )
      throw new Error('Expected readable fixtures')
    retained.resource = {
      kind: 'retained-unavailable',
      lastSuccessful: retained.resource.observation,
      unavailable: {
        kind: 'no-current-evidence',
        scope: { kind: 'ticket', ticket: retained.ref },
        cause: 'No current source observation is available.',
      },
    }
    const blocker = {
      reference: { kind: 'registered', ticket: retained.ref },
      state: 'unknown',
    } as const
    dependent.resource.observation.value = {
      ...dependent.resource.observation.value,
      state: 'blocked',
      isBlocked: true,
      blockedBy: [blocker],
    }
    populateMap(map, [dependent, retained])
    const selected = resolveSelection(
      makeApplicationState([currentProject(project.projectId, [map])]),
      {
        project,
        map: map.ref,
        ticket: dependent.ref,
      },
    )
    const result = selected.ticket?.blockers[0]
    expect(result).toMatchObject({
      state: 'unknown',
      graphStateLabel: 'State unknown',
      tracker: { state: 'frontier' },
      availability: { kind: 'retained-unavailable' },
    })
    expect(result?.message).toContain('Blocker state is unknown.')
    expect(result?.message).toContain('No current source observation is available.')
    const merged = presentBlockerResource(
      { ...blocker, state: 'closed', title: 'Merged' },
      map.ref,
      {
        scope: 'missing',
        target: result,
      },
    )
    expect(merged).toMatchObject({
      title: 'Merged',
      state: 'closed',
      graphStateLabel: 'Closed blocker',
      graphMessage: null,
      availability: { kind: 'retained-unavailable' },
    })
    expect(merged.message).not.toContain('Blocker state is unknown.')
    expect(merged.message).toContain('No current source observation is available.')
  })

  it('keeps every pinned identity and durable evidence after Project removal', () => {
    const read = makeApplicationState([], {
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        overrides: [],
        evidence: [
          {
            target,
            classification,
            wayfinder: {
              status: 'outcome-unknown',
              admission: 'override',
              reason: 'Interrupted.',
              acknowledged: false,
            },
          },
        ],
      },
    })
    const selected = resolveSelection(read, { project, map: mapRef, ticket: target })
    expect(selected.kind).toBe('pinned')
    expect(selected.project).toMatchObject({ kind: 'missing', ref: project })
    expect(selected.map).toMatchObject({ kind: 'missing', ref: mapRef })
    expect(selected.ticket).toMatchObject({ kind: 'missing', ref: target })
    expect(selected.ticket?.automation.evidence?.session?.status).toBe('outcome-unknown')
    expect(resolveProject(read, project).automation.interruptions[0]).toMatchObject({
      target,
      navigation: { ticket: target },
      project: { kind: 'missing' },
      map: { kind: 'missing' },
      ticket: { kind: 'missing' },
    })
  })

  it('labels queued Session admission as absent without losing Classification admission or process exit', () => {
    const read = makeApplicationState([], {
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        overrides: [],
        evidence: [{ target, classification, wayfinder: { status: 'queued' } }],
      },
    })
    const evidence = resolveSelection(read, { project, map: mapRef, ticket: target }).ticket
      ?.automation.evidence
    expect(evidence?.session).toMatchObject({
      status: 'queued',
      admission: { kind: 'none', label: 'No launch admission' },
    })
    expect(evidence?.classification.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: 'Admission', value: 'Automatic' }),
        expect.objectContaining({ term: 'Process result', value: 'Exited 7' }),
        expect.objectContaining({ term: 'Verdict', value: 'AFK' }),
      ]),
    )
  })

  it('keeps acknowledged interruption outcomes unknown but removes the review requirement', () => {
    const read = makeApplicationState([], {
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        overrides: [],
        evidence: [
          {
            target,
            classification,
            wayfinder: {
              status: 'outcome-unknown',
              admission: 'automatic',
              reason: 'Interrupted.',
              acknowledged: true,
            },
          },
        ],
      },
    })
    expect(presentAutomation(read).interruptions).toEqual([])
    expect(
      resolveSelection(read, { project, map: mapRef, ticket: target }).ticket?.automation.evidence
        ?.session,
    ).toMatchObject({ status: 'outcome-unknown', acknowledged: true })
  })

  it('does not choose a readable sibling under uncertain ordering', () => {
    const unread = neverReadProject(project)
    const sibling = readableMap(project, 'sibling')
    unread.maps = [sibling]
    const result = resolveSelection(makeApplicationState([unread]), {
      project,
      map: null,
      ticket: null,
    })
    expect(result.kind).toBe('no-trustworthy-default')
    expect(result.map).toBeNull()
    expect(result.project.kind === 'known' && result.project.navigation.unplaced[0]?.ref).toEqual(
      sibling.ref,
    )
  })

  it('selects only the requested map when ticket IDs repeat in siblings', () => {
    const first = readableMap(project, 'first')
    const second = readableMap(project, 'second')
    const firstTicket = readableTicket(first, 'same')
    first.tickets = [firstTicket]
    second.tickets = [readableTicket(second, 'same')]
    if (second.tickets[0]?.resource.kind !== 'current-readable')
      throw new Error('Expected readable fixture')
    second.tickets[0].resource.observation.value.title = 'Second scoped ticket'
    if (
      first.ticketsMembership.kind !== 'current-complete' ||
      second.ticketsMembership.kind !== 'current-complete'
    )
      throw new Error('Expected complete membership fixtures')
    first.ticketsMembership.observation.value.members = [firstTicket.ref]
    second.ticketsMembership.observation.value.members = [second.tickets[0].ref]
    first.frontier = [firstTicket.ref]
    second.frontier = [second.tickets[0].ref]
    const read = makeApplicationState([currentProject(project.projectId, [first, second])])
    const selected = resolveSelection(read, {
      project,
      map: second.ref,
      ticket: second.tickets[0].ref,
    })
    expect(selected.ticket?.title).toBe('Second scoped ticket')
  })

  it('keeps known-empty distinct from never-read and permits a trusted closed default', () => {
    const empty = currentProject('empty')
    const closed = readableMap(empty.ref, 'closed', 'closed')
    const resting = currentProject('empty', [closed])
    expect(
      resolveSelection(makeApplicationState([empty]), {
        project: empty.ref,
        map: null,
        ticket: null,
      }).kind,
    ).toBe('known-empty')
    expect(
      resolveSelection(makeApplicationState([resting]), {
        project: empty.ref,
        map: null,
        ticket: null,
      }),
    ).toMatchObject({ kind: 'default-closed', map: { ref: closed.ref } })
  })

  it('uses server aggregate progress beyond fetched tickets and preserves independent controls', () => {
    const content = readableMap(project, 'map')
    const tracked = readableTicket(content, 'same')
    if (
      tracked.resource.kind !== 'current-readable' ||
      content.resource.kind !== 'current-readable'
    )
      throw new Error('Expected readable fixtures')
    tracked.resource.observation.value = {
      ...tracked.resource.observation.value,
      isBlocked: true,
      isClaimed: true,
      blockersComplete: false,
      state: 'blocked',
    }
    content.tickets = [tracked]
    if (content.ticketsMembership.kind === 'current-complete')
      content.ticketsMembership.observation.value.members = [tracked.ref]
    content.resource.observation.value.progress = { total: 40, completed: 12 }
    content.resource.observation.completeness = { kind: 'incomplete', reason: 'pagination' }
    const ref = tracked.ref
    const read = makeApplicationState([currentProject(project.projectId, [content])], {
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        evidence: [],
        overrides: [
          {
            target: ref,
            classification: { status: 'eligible' },
            wayfinder: { status: 'ineligible', reason: 'Server admission denied.' },
          },
        ],
      },
    })
    expect(presentProjects(read).active).toEqual([])
    expect(presentProjects(read).uncertain[0]).toMatchObject({
      decisions: null,
      openTickets: null,
      currentMap: null,
    })
    const selected = resolveSelection(read, { project, map: content.ref, ticket: ref })
    expect(selected.map).toMatchObject({ progress: { total: 40, completed: 12 } })
    expect(selected.ticket?.tracker).toMatchObject({
      label: 'Blocked + claimed',
      isBlocked: true,
      isClaimed: true,
    })
    expect(selected.ticket?.automation.controls).toMatchObject({
      classification: { status: 'eligible' },
      wayfinder: { status: 'ineligible', reason: 'Server admission denied.' },
    })
  })

  it('does not require Session acknowledgement for an unknown Classification', () => {
    const read = makeApplicationState([], {
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        overrides: [],
        evidence: [
          {
            target,
            classification: {
              status: 'outcome-unknown',
              admission: 'automatic',
              reason: 'Classifier interrupted.',
            },
          },
        ],
      },
    })
    expect(resolveProject(read, project).automation.reviewRequired).toBe(false)
    expect(presentAutomation(read).historicalEvidence[0]).toMatchObject({
      target,
      project: { kind: 'missing' },
      map: { kind: 'missing' },
      ticket: { kind: 'missing' },
    })
  })

  it('keeps incomplete source aggregates visible without asserting a complete portfolio total', () => {
    const map = readableMap(project, 'partial')
    if (map.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
    map.resource.observation.completeness = { kind: 'incomplete', reason: 'pagination' }
    map.resource.observation.value.progress = { total: 12, completed: 7 }
    const read = makeApplicationState([currentProject(project.projectId, [map])])
    expect(presentProjects(read).uncertain[0]?.decisions).toBeNull()
    expect(resolveSelection(read, { project, map: map.ref, ticket: null }).map).toMatchObject({
      progress: { total: 12, completed: 7 },
    })
  })

  it('separates retained observed source from current management locator', () => {
    const known = currentProject(project.projectId)
    if (known.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
    known.resource = {
      kind: 'retained-unavailable',
      lastSuccessful: known.resource.observation,
      unavailable: {
        kind: 'no-current-evidence',
        scope: { kind: 'project', project },
        cause: 'No current source observation is available.',
      },
    }
    if (known.mapsMembership.kind !== 'current-complete')
      throw new Error('Expected complete membership fixture')
    known.mapsMembership = {
      kind: 'unavailable',
      lastComplete: known.mapsMembership.observation,
      unavailable: {
        kind: 'no-current-evidence',
        scope: { kind: 'project', project },
        cause: 'No current source observation is available.',
      },
    }
    known.activeMap = {
      kind: 'uncertain',
      reason: 'project-unavailable',
      cause: 'Project source is currently unavailable.',
    }
    if (known.integration !== 'local') throw new Error('Expected Local fixture')
    known.source.path = '/tmp/replacement'
    const result = resolveProject(makeApplicationState([known]), project)
    expect(result).toMatchObject({
      source: { kind: 'file', path: '/tmp/replacement' },
      observedSource: { kind: 'file', path: '/tmp/project-home' },
    })
    expect(result).toMatchObject({
      availability: { kind: 'retained-unavailable' },
      currentMap: null,
      mapCount: null,
    })
    expect(resourceObservation(known.resource)?.provenance).toMatchObject({
      integration: 'local',
      path: '/tmp/project-home',
    })
  })

  it('preserves Process result and disagreeing Session report as separate facts', () => {
    const read = makeApplicationState([], {
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        overrides: [],
        evidence: [
          {
            target,
            classification,
            wayfinder: {
              status: 'finished',
              admission: 'override',
              processResult: { status: 'exited', code: 9 },
              report: {
                status: 'received',
                report: { outcome: 'completed', reason: 'The report claims completion.' },
              },
            },
          },
        ],
      },
    })
    const session = resolveSelection(read, { project, map: mapRef, ticket: target }).ticket
      ?.automation.evidence?.session
    expect(session?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: 'Process result', value: 'Exited 9' }),
        expect.objectContaining({
          term: 'Session report',
          value: 'Completed',
          detail: 'The report claims completion.',
        }),
      ]),
    )
  })

  it('returns all scoped review interruptions without depending on live resource membership', () => {
    const second = ticketRefSchema.parse({
      map: { project, mapId: 'second missing map' },
      ticketId: target.ticketId,
    })
    const unrelated = ticketRefSchema.parse({
      map: { project: { integration: 'local', projectId: 'other' }, mapId: mapRef.mapId },
      ticketId: target.ticketId,
    })
    const evidence = [target, second, unrelated].map(
      (target) =>
        ({
          target,
          classification,
          wayfinder: {
            status: 'outcome-unknown',
            admission: 'automatic',
            reason: 'Interrupted.',
            acknowledged: false,
          },
        }) as const,
    )
    const read = makeApplicationState([], {
      automation: {
        enabled: false,
        enabledProjects: [],
        availability: { status: 'ready' },
        overrides: [],
        evidence,
      },
    })
    expect(
      resolveProject(read, project).automation.interruptions.map((item) => item.target),
    ).toEqual([target, second])
    expect(presentAutomation(read).interruptions).toHaveLength(3)
  })

  it('retains historical Map source and absence proof without changing pinned selection', () => {
    const map = absentMap(readableMap(project, 'historical'))
    const known = currentProject(project.projectId)
    known.maps = [map]
    const read = makeApplicationState([known])
    const selected = resolveSelection(read, { project, map: map.ref, ticket: null })
    expect(selected).toMatchObject({
      kind: 'pinned',
      map: {
        kind: 'known',
        ref: map.ref,
        source: { kind: 'file', path: '/tmp/project-home/maps/historical.md' },
        availability: { kind: 'proven-absent' },
        statusLabel: 'Historical map',
      },
    })
    expect(resourceObservation(map.resource)?.value.title).toBe('Map historical')
    expect(selected.map).toMatchObject({
      availability: {
        kind: 'proven-absent',
        absence: {
          proof: { kind: 'complete-membership', parent: { kind: 'maps-membership', project } },
        },
      },
    })
  })

  it('selects the latest waiting authorization independently of Connection health and Project source', () => {
    const id = connectionIdSchema.parse('github')
    const waiting = {
      id: authorizationOperationIdSchema.parse('waiting'),
      status: 'waiting',
      connectionId: id,
      verificationUri: 'https://example.test/device',
      userCode: 'CODE',
      expiresAt: 2_000,
    } as const
    const denied = {
      id: authorizationOperationIdSchema.parse('denied'),
      status: 'terminal',
      outcome: 'denied',
      connectionId: id,
      cause: 'Denied by GitHub.',
    } as const
    const read = makeApplicationState([], {
      connections: [
        {
          id,
          integration: 'github',
          builtIn: false,
          name: 'GitHub',
          githubIdentity: { id: 'account', login: 'tester' },
          availability: {
            status: 'degraded',
            cause: 'Transient source failure.',
            observedAt: 1_000,
          },
        },
      ],
      authorizationOperations: [waiting, denied],
    })
    expect(resolveConnection(read, id)).toMatchObject({
      kind: 'known',
      health: {
        status: 'degraded',
        label: 'Observation degraded',
        cause: 'Transient source failure.',
        observedAt: 1_000,
      },
      currentAuthorization: { kind: 'waiting', id: waiting.id },
      projectCount: 0,
    })
    const historical = resolveAuthorization(read, {
      id: authorizationOperationIdSchema.parse('historical'),
      status: 'granted',
      connection: { kind: 'historical', id, accountId: 'previous-account' },
    })
    expect(historical.kind).toBe('granted-historical')
    expect(historical).not.toHaveProperty('navigation')
  })
})
