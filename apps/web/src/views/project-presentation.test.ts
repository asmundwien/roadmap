import type {
  ApplicationState,
  AutomationEvidence,
  Connection,
  RegisteredProject,
  Ticket,
  WayfinderMap,
} from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { presentAutomation, presentProjects } from './project-presentation.ts'

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

describe('presentAutomation', () => {
  it('counts queued, active, and terminal stages independently by scope', () => {
    const tickets = [
      automationTicket('running'),
      automationTicket('queued'),
      automationTicket('session'),
      automationTicket('unknown'),
    ]
    const alphaMap = { ...map('map', true, 3_000), tickets }
    const alpha = project('alpha', { openMaps: [alphaMap] })
    const beta = project('beta')
    const evidence: AutomationEvidence[] = [
      {
        target: automationTarget('alpha', 'running'),
        classification: { status: 'running', admission: 'automatic' },
      },
      {
        target: automationTarget('alpha', 'queued'),
        classification: {
          status: 'completed',
          admission: 'automatic',
          processResult: { status: 'exited', code: 0 },
          verdict: { value: 'afk', reason: 'Safe to queue.' },
        },
        wayfinder: { status: 'queued' },
      },
      {
        target: automationTarget('alpha', 'session'),
        classification: {
          status: 'completed',
          admission: 'override',
          processResult: { status: 'exited', code: 0 },
          verdict: { value: 'afk', reason: 'Safe to run.' },
        },
        wayfinder: { status: 'running', admission: 'override' },
      },
      {
        target: automationTarget('alpha', 'unknown'),
        classification: {
          status: 'outcome-unknown',
          admission: 'automatic',
          reason: 'Roadmap restarted.',
        },
        wayfinder: {
          status: 'outcome-unknown',
          admission: 'automatic',
          reason: 'Roadmap restarted.',
          acknowledged: false,
        },
      },
      {
        target: automationTarget('removed', 'launch'),
        classification: {
          status: 'launch-failed',
          admission: 'automatic',
          reason: 'Command missing.',
        },
      },
    ]

    const presentation = presentAutomation({ projects: [alpha, beta], automation: { evidence } })

    expect(presentation.global.classification).toEqual({ active: 1, terminal: 4 })
    expect(presentation.global.wayfinder).toEqual({ queued: 1, active: 1, terminal: 1 })
    expect(presentation.global.tickets).toHaveLength(5)
    expect(presentation.projects[0]?.summary).toMatchObject({
      classification: { active: 1, terminal: 3 },
      wayfinder: { queued: 1, active: 1, terminal: 1 },
    })
    expect(presentation.projects[0]?.summary.tickets).toHaveLength(4)
    expect(presentation.projects[1]?.summary.tickets).toHaveLength(0)
  })

  it('resolves affected tickets while retaining evidence whose Project is no longer registered', () => {
    const knownTicket = automationTicket('known')
    const knownMap = { ...map('map', false, 2_000), tickets: [knownTicket] }
    const knownProject = project('known-project', { closedMaps: [knownMap] })
    const evidence: AutomationEvidence[] = [
      {
        target: automationTarget('known-project', 'known'),
        classification: { status: 'running', admission: 'automatic' },
      },
      {
        target: automationTarget('removed-project', 'missing'),
        classification: { status: 'running', admission: 'automatic' },
      },
    ]

    const presentation = presentAutomation({
      projects: [knownProject],
      automation: { evidence },
    })

    expect(presentation.global.tickets[0]).toMatchObject({
      project: knownProject,
      map: knownMap,
      ticket: knownTicket,
    })
    expect(presentation.global.tickets[1]).toMatchObject({
      project: null,
      map: null,
      ticket: null,
    })
  })
})

function automationTarget(projectId: string, ticketId: string) {
  return {
    project: { integration: 'local' as const, id: projectId },
    mapId: 'map',
    ticketId,
  }
}

function automationTicket(id: string): Ticket {
  return {
    id,
    displayId: id,
    title: `Ticket ${id}`,
    body: '',
    typeEvidence: { kind: 'recognized', value: 'task', labels: ['wayfinder:task'] },
    state: 'closed',
    isClaimed: false,
    isBlocked: false,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
  }
}
