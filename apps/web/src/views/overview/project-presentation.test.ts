import type {
  ApplicationState,
  Connection,
  RegisteredProject,
  WayfinderMap,
} from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { presentProjects } from './project-presentation'

const AVAILABLE_CONNECTION: Connection = {
  id: 'local',
  integration: 'local',
  name: 'On this Mac',
  builtIn: true,
  availability: { status: 'available', observedAt: 1_000 },
}

function map(id: string, isOpen: boolean, updatedAt: number): WayfinderMap {
  return {
    project: { integration: 'local', id: 'project' },
    id,
    title: `Map ${id}`,
    isOpen,
    updatedAt,
    ...(isOpen ? {} : { closedAt: updatedAt }),
    body: {
      raw: '',
      destination: `**Destination ${id}**`,
      notes: [],
      decisions: [],
      notYetSpecified: isOpen ? ['Unknown territory'] : [],
      notYetSpecifiedNote: '',
      outOfScope: [],
      sections: [],
      missingSections: [],
    },
    tickets: [],
    frontier: [],
    progress: { total: 4, completed: 3 },
    ticketsComplete: true,
    warnings: [],
  }
}

function project(id: string, overrides: Partial<RegisteredProject> = {}): RegisteredProject {
  return {
    key: { integration: 'local', id },
    connectionId: 'local',
    locator: { integration: 'local', path: `/tmp/${id}` },
    workspace: { path: `/tmp/${id}` },
    name: id,
    availability: { status: 'available', observedAt: 1_000 },
    openMaps: [],
    closedMaps: [],
    warnings: [],
    actions: [],
    ...overrides,
  }
}

function state(
  projects: RegisteredProject[],
  connections: Connection[] = [AVAILABLE_CONNECTION],
): Pick<ApplicationState, 'connections' | 'projects' | 'configuration'> {
  return {
    connections,
    projects,
    configuration: { valid: true, issues: [], notices: [] },
  }
}

describe('presentProjects', () => {
  it('classifies every registration while retaining an unavailable last-known active trace', () => {
    const active = project('active', {
      availability: { status: 'unavailable', cause: 'Folder is offline.', observedAt: 900 },
      openMaps: [map('active', true, 3_000)],
    })
    const resting = project('resting', { closedMaps: [map('closed', false, 2_000)] })
    const waiting = project('waiting')

    const presentation = presentProjects(state([waiting, resting, active]))

    expect(presentation.active.map((entry) => entry.project.name)).toEqual(['active'])
    expect(presentation.resting.map((entry) => entry.project.name)).toEqual(['resting'])
    expect(presentation.waiting.map((entry) => entry.project.name)).toEqual(['waiting'])
    expect(presentation.active[0]).toMatchObject({
      destination: 'Destination active',
      decisions: 3,
      openTickets: 1,
      hasFog: true,
    })
    expect(presentation.attention).toContainEqual(
      expect.objectContaining({
        kind: 'project',
        title: 'active is unavailable',
        detail: 'On this Mac: Folder is offline.',
      }),
    )
  })

  it('preserves unknown decisions and open-ticket totals for an active Map', () => {
    const unknown = project('unknown', {
      openMaps: [{ ...map('active', true, 3_000), progress: null, ticketsComplete: false }],
      closedMaps: [map('closed', false, 2_000)],
    })

    expect(presentProjects(state([unknown])).active[0]).toMatchObject({
      decisions: null,
      openTickets: null,
    })
  })

  it('does not report a partial decision sum when one Map aggregate is unknown', () => {
    const mixed = project('mixed', {
      openMaps: [map('active', true, 3_000)],
      closedMaps: [{ ...map('closed', false, 2_000), progress: null, ticketsComplete: false }],
    })

    expect(presentProjects(state([mixed])).active[0]).toMatchObject({
      decisions: null,
      openTickets: 1,
    })
  })

  it('retains zero open tickets without an active Map even when decisions are unknown', () => {
    const resting = project('resting', {
      closedMaps: [{ ...map('closed', false, 2_000), progress: null, ticketsComplete: false }],
    })

    expect(presentProjects(state([resting])).resting[0]).toMatchObject({
      decisions: null,
      openTickets: 0,
    })
  })

  it('retains exact totals when every Map aggregate is known', () => {
    const known = project('known', {
      openMaps: [map('active', true, 3_000)],
      closedMaps: [map('closed', false, 2_000)],
    })

    expect(presentProjects(state([known])).active[0]).toMatchObject({
      decisions: 6,
      openTickets: 1,
    })
    expect(presentProjects(state([project('empty')])).waiting[0]).toMatchObject({
      decisions: 0,
      openTickets: 0,
    })
    const zero = project('zero', {
      openMaps: [{ ...map('zero', true, 3_000), progress: { total: 0, completed: 0 } }],
    })
    expect(presentProjects(state([zero])).active[0]).toMatchObject({
      decisions: 0,
      openTickets: 0,
    })
  })

  it('orders active Projects by current-map recency', () => {
    const older = project('older', { openMaps: [map('older', true, 2_000)] })
    const newer = project('newer', { openMaps: [map('newer', true, 4_000)] })

    expect(
      presentProjects(state([older, newer])).active.map((entry) => entry.project.name),
    ).toEqual(['newer', 'older'])
  })

  it('keeps configuration, Connection, Project availability, and parse warnings distinct', () => {
    const connection: Connection = {
      ...AVAILABLE_CONNECTION,
      availability: { status: 'authorization-required', cause: 'The token expired.' },
    }
    const warned = project('Warned', {
      availability: { status: 'unavailable', cause: 'Repository cannot be read.' },
      warnings: ['Map body is missing Destination.'],
    })
    const input = state([warned], [connection])
    input.configuration = {
      valid: false,
      issues: [{ path: 'projects[0]', message: 'The saved file is invalid.' }],
      notices: [],
    }

    expect(presentProjects(input).attention.map((item) => item.kind)).toEqual([
      'configuration',
      'connection',
      'project',
      'project',
    ])
    expect(presentProjects(input).attention.map((item) => item.title)).toEqual([
      'Configuration needs attention',
      'On this Mac needs authorization',
      'Warned is unavailable',
      'Warned has a warning',
    ])
  })
  it('reports stale Connection observations without marking Projects unavailable', () => {
    const connection: Connection = {
      ...AVAILABLE_CONNECTION,
      availability: {
        status: 'degraded',
        cause: 'GitHub observations are temporarily failing.',
        observedAt: 900,
      },
    }

    expect(presentProjects(state([project('Readable')], [connection])).attention).toEqual([
      expect.objectContaining({
        kind: 'connection',
        title: 'On this Mac observations are stale',
        detail:
          'GitHub observations are temporarily failing. Last-good data is retained for: Readable.',
      }),
    ])
  })
})
