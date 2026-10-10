import { connectionIdSchema, projectIdSchema, ticketRefSchema } from '@roadmap/contracts/identity'
import type {
  Connection,
  MapResource,
  Project,
  ReadyApplicationState,
} from '@roadmap/contracts/state'
import { describe, expect, it } from 'vitest'
import { presentProjects, resolveProject } from '@/resources/results'
import { makeApplicationState } from '@/views/map/test-fixtures'
import {
  absentMap,
  currentProject,
  neverReadProject,
  readableMap,
} from '@/views/overview/test-fixtures'

const connection: Connection = {
  id: connectionIdSchema.parse('local'),
  integration: 'local',
  name: 'On this Mac',
  builtIn: true,
  availability: { status: 'available', observedAt: 1_000 },
}
function state(
  projects: Project[],
  connections: Connection[] = [connection],
  configuration: ReadyApplicationState['configuration'] = { valid: true, issues: [], notices: [] },
): ReadyApplicationState {
  return makeApplicationState(projects, {
    connections,
    configuration,
    mode: configuration.valid ? 'mutable' : 'read-only',
  })
}
function map(
  id: string,
  mapId: string,
  status: 'open' | 'closed' = 'open',
  updatedAt = 3_000,
): MapResource {
  return readableMap(
    { integration: 'local', projectId: projectIdSchema.parse(id) },
    mapId,
    status,
    updatedAt,
  )
}
function unknownProgress(map: MapResource): MapResource {
  if (map.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
  return {
    ...map,
    resource: {
      kind: 'current-readable',
      observation: {
        ...map.resource.observation,
        completeness: { kind: 'incomplete', reason: 'malformed' },
        value: { ...map.resource.observation.value, progress: null },
      },
    },
  }
}
function uncertain(project: Project): Project {
  return {
    ...project,
    activeMap: {
      kind: 'uncertain',
      reason: 'map-incomplete',
      cause: 'A map required for ordering is incomplete.',
    },
  }
}

describe('presentProjects', () => {
  it('separates known active, known closed, known empty and never-read registrations', () => {
    const result = presentProjects(
      state([
        currentProject('active', [map('active', 'active')]),
        currentProject('resting', [map('resting', 'closed', 'closed')]),
        currentProject('empty'),
        neverReadProject({ integration: 'local', projectId: projectIdSchema.parse('unread') }),
      ]),
    )
    expect(result.active.map((entry) => entry.name)).toEqual(['active'])
    expect(result.resting.map((entry) => entry.name)).toEqual(['resting'])
    expect(result.waiting.map((entry) => entry.name)).toEqual(['empty'])
    expect(result.uncertain.map((entry) => entry.name)).toEqual(['unread'])
    expect(result.waiting[0]).toMatchObject({ decisions: 0, openTickets: 0, mapCount: 0 })
    expect(result.uncertain[0]).toMatchObject({
      decisions: null,
      openTickets: null,
      mapCount: null,
    })
  })

  it('does not promote readable siblings while catalog ordering is uncertain', () => {
    const first = map('project', 'first')
    const second = map('project', 'second', 'open', 9_000)
    const project = uncertain(currentProject('project', [first, second]))
    project.displayOrder = { open: [first.ref], closed: [] }
    const result = presentProjects(state([project]))
    expect(result.active).toEqual([])
    expect(result.uncertain[0]?.currentMap).toBeNull()
    expect(result.uncertain[0]?.maps.map((map) => map.ref)).toEqual([first.ref, second.ref])
  })

  it('keeps incomplete readable aggregates unknown rather than zero', () => {
    const project = uncertain(
      currentProject('unknown', [
        unknownProgress(map('unknown', 'open')),
        map('unknown', 'closed', 'closed'),
      ]),
    )
    expect(presentProjects(state([project])).uncertain[0]).toMatchObject({
      decisions: null,
      openTickets: null,
    })
  })

  it('does not report a partial decision sum when any current aggregate is unknown', () => {
    const project = uncertain(
      currentProject('mixed', [
        map('mixed', 'open'),
        unknownProgress(map('mixed', 'closed', 'closed')),
      ]),
    )
    expect(presentProjects(state([project])).uncertain[0]?.decisions).toBeNull()
  })

  it('does not sum readable partial aggregates even when each reports progress', () => {
    const partial = map('partial', 'closed', 'closed')
    if (partial.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
    partial.resource.observation.completeness = { kind: 'incomplete', reason: 'pagination' }
    partial.resource.observation.value.progress = { total: 40, completed: 12 }
    const project = currentProject('partial', [map('partial', 'open'), partial])
    expect(presentProjects(state([project])).uncertain[0]).toMatchObject({
      decisions: null,
      currentMap: null,
    })
  })

  it('retains exact aggregate totals and known zero counts', () => {
    expect(
      presentProjects(
        state([currentProject('known', [map('known', 'open'), map('known', 'closed', 'closed')])]),
      ).active[0],
    ).toMatchObject({ decisions: 6, openTickets: 1, hasFog: true, destination: 'Destination open' })
    const zero = map('zero', 'zero')
    if (zero.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
    zero.resource.observation.value.progress = { total: 0, completed: 0 }
    expect(presentProjects(state([currentProject('zero', [zero])])).active[0]).toMatchObject({
      decisions: 0,
      openTickets: 0,
    })
  })

  it('uses complete server aggregates rather than counting fetched tickets', () => {
    const complete = map('aggregate', 'open')
    if (complete.resource.kind !== 'current-readable') throw new Error('Expected readable fixture')
    complete.resource.observation.value.progress = { total: 40, completed: 12 }
    expect(
      presentProjects(state([currentProject('aggregate', [complete])])).active[0],
    ).toMatchObject({
      decisions: 12,
      openTickets: 28,
    })
  })

  it('excludes absent historical maps from current membership totals without losing trace', () => {
    const historical = absentMap(map('project', 'absent'))
    const project = currentProject('project')
    project.maps = [historical]
    expect(presentProjects(state([project])).waiting[0]).toMatchObject({
      decisions: 0,
      mapCount: 0,
    })
    expect(presentProjects(state([project])).waiting[0]?.maps[0]?.availability.kind).toBe(
      'proven-absent',
    )
  })

  it('orders known active Projects by their actual map activity', () => {
    const older = currentProject('older', [map('older', 'map', 'open', 2_000)])
    const newer = currentProject('newer', [map('newer', 'map', 'open', 4_000)])
    expect(presentProjects(state([older, newer])).active.map((entry) => entry.name)).toEqual([
      'newer',
      'older',
    ])
  })

  it('keeps configuration, Connection, source and Workspace warnings independent', () => {
    const project = neverReadProject({
      integration: 'local',
      projectId: projectIdSchema.parse('warned'),
    })
    project.managementWarnings = ['Workspace proof is unavailable.']
    const input = state(
      [project],
      [
        {
          ...connection,
          availability: { status: 'authorization-required', cause: 'Authorization is required.' },
        },
      ],
      {
        valid: false,
        issues: [{ path: 'projects[0]', message: 'Configuration is invalid.' }],
        notices: [],
      },
    )
    expect(presentProjects(input).attention.map((item) => item.kind)).toEqual([
      'configuration',
      'connection',
      'project',
      'project',
    ])
  })

  it('does not demote readable Projects because Connection observations are stale', () => {
    const project = currentProject('readable')
    const result = presentProjects(
      state(
        [project],
        [
          {
            ...connection,
            availability: {
              status: 'degraded',
              cause: 'Source reads are failing.',
              observedAt: 900,
            },
          },
        ],
      ),
    )
    expect(result.waiting).toHaveLength(1)
    expect(result.attention.map((item) => item.kind)).toEqual(['connection'])
  })

  it('reports degraded Connection health without claiming current-readable dependents are retained', () => {
    const active = currentProject('active', [map('active', 'current')])
    const empty = currentProject('empty')
    const result = presentProjects(
      state(
        [active, empty],
        [
          {
            ...connection,
            availability: {
              status: 'degraded',
              cause: 'Source reads are failing.',
              observedAt: 900,
            },
          },
        ],
      ),
    )

    expect(result.active[0]).toMatchObject({ decisions: 3, openTickets: 1, mapCount: 1 })
    expect(result.waiting[0]).toMatchObject({ decisions: 0, openTickets: 0, mapCount: 0 })
    expect(result.uncertain).toEqual([])
    expect(result.attention).toHaveLength(1)
    expect(result.attention[0]).toMatchObject({ kind: 'connection', connectionId: connection.id })
    expect(result.attention[0]?.detail).toContain('Source reads are failing.')
    expect(result.attention[0]?.detail).toContain('active')
    expect(result.attention[0]?.detail).toContain('empty')
    expect(result.attention[0]?.detail).not.toContain('Last-good data is retained')
  })

  it('scopes durable Automation evidence without dropping removed targets from the portfolio', () => {
    const first = currentProject('first')
    const second = currentProject('second')
    const targets = [first.ref, second.ref, { integration: 'local', projectId: 'removed' }].map(
      (project) => ticketRefSchema.parse({ map: { project, mapId: 'missing' }, ticketId: 'same' }),
    )
    const input = makeApplicationState([first, second], {
      automation: {
        enabled: false,
        enabledProjects: [second.ref],
        availability: { status: 'unavailable', cause: 'Command unavailable.' },
        overrides: [],
        evidence: targets.map((target, index) => ({
          target,
          classification: {
            status: 'completed',
            admission: 'override',
            processResult: { status: 'exited', code: 7 },
            verdict: { value: 'afk', reason: 'Unattended.' },
          },
          wayfinder: {
            status: 'outcome-unknown',
            admission: 'automatic',
            reason: 'Interrupted.',
            acknowledged: index === 1,
          },
        })),
      },
    })
    const result = presentProjects(input)
    expect(result.automation.evidence.map((item) => item.target)).toEqual(targets)
    expect(result.automation.interruptions.map((item) => item.target)).toEqual([
      targets[0],
      targets[2],
    ])
    expect(result.automation.historicalEvidence.map((item) => item.target)).toEqual([targets[1]])
    expect(result.projects[0]?.automation).toMatchObject({
      projectEnabled: false,
      reviewRequired: true,
      availabilityCause: 'Command unavailable.',
      evidence: [
        { target: targets[0], classification: { processResult: { status: 'exited', code: 7 } } },
      ],
      interruptions: [{ target: targets[0], ticket: { kind: 'missing' } }],
      historicalEvidence: [],
    })
    expect(result.projects[1]?.automation).toMatchObject({
      projectEnabled: true,
      reviewRequired: false,
      interruptions: [],
      evidence: [{ target: targets[1] }],
      historicalEvidence: [{ target: targets[1] }],
    })
    expect(resolveProject(input, first.ref).automation).toEqual(result.projects[0]?.automation)
    expect(resolveProject(input, second.ref).automation).toEqual(result.projects[1]?.automation)
    expect(
      resolveProject(input, ticketRefSchema.parse(targets[2]).map.project).automation,
    ).toMatchObject({
      evidence: [{ target: targets[2] }],
      interruptions: [{ target: targets[2] }],
      reviewRequired: true,
    })
  })
})
