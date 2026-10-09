import type {
  ApplicationState,
  Connection,
  MapResource,
  RegisteredProject,
} from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { presentProjects } from './project-presentation'
import { absentMap, currentProject, neverReadProject, readableMap } from './test-fixtures'

const connection: Connection = {
  id: 'local',
  integration: 'local',
  name: 'On this Mac',
  builtIn: true,
  availability: { status: 'available', observedAt: 1_000 },
}
function state(
  projects: RegisteredProject[],
  connections: Connection[] = [connection],
): Pick<ApplicationState, 'projects' | 'connections' | 'configuration'> {
  return { projects, connections, configuration: { valid: true, issues: [], notices: [] } }
}
function map(
  id: string,
  mapId: string,
  status: 'open' | 'closed' = 'open',
  updatedAt = 3_000,
): MapResource {
  return readableMap({ integration: 'local', id }, mapId, status, updatedAt)
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
function uncertain(project: RegisteredProject): RegisteredProject {
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
        neverReadProject({ integration: 'local', id: 'unread' }),
      ]),
    )
    expect(result.active.map((entry) => entry.project.name)).toEqual(['active'])
    expect(result.resting.map((entry) => entry.project.name)).toEqual(['resting'])
    expect(result.waiting.map((entry) => entry.project.name)).toEqual(['empty'])
    expect(result.uncertain.map((entry) => entry.project.name)).toEqual(['unread'])
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
    project.displayOrder = { openMapIds: ['first'], closedMapIds: [] }
    const result = presentProjects(state([project]))
    expect(result.active).toEqual([])
    expect(result.uncertain[0]?.activeMap).toBeNull()
    expect(result.uncertain[0]?.project.maps).toEqual([first, second])
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

  it('excludes absent historical maps from current membership totals without losing trace', () => {
    const historical = absentMap(map('project', 'absent'))
    const project = currentProject('project')
    project.maps = [historical]
    expect(presentProjects(state([project])).waiting[0]).toMatchObject({
      decisions: 0,
      mapCount: 0,
    })
    expect(project.maps[0]?.resource.kind).toBe('proven-absent')
  })

  it('orders known active Projects by their actual map activity', () => {
    const older = currentProject('older', [map('older', 'map', 'open', 2_000)])
    const newer = currentProject('newer', [map('newer', 'map', 'open', 4_000)])
    expect(
      presentProjects(state([older, newer])).active.map((entry) => entry.project.name),
    ).toEqual(['newer', 'older'])
  })

  it('keeps configuration, Connection, source and Workspace warnings independent', () => {
    const project = neverReadProject({ integration: 'local', id: 'warned' })
    project.managementWarnings = ['Workspace proof is unavailable.']
    const input = state(
      [project],
      [
        {
          ...connection,
          availability: { status: 'authorization-required', cause: 'Authorization is required.' },
        },
      ],
    )
    input.configuration = {
      valid: false,
      issues: [{ path: 'projects[0]', message: 'Configuration is invalid.' }],
      notices: [],
    }
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
})
