import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TicketState } from '@roadmap/contracts/state'
import { describe, expect, it } from 'vitest'
import type { ChangeEvent } from '../change-feed.ts'
import type { ConfigurationDocument } from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import { createGitHubConnectionPort } from '../github/connections.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import type {
  ObservationAttempt,
  ObservationBatch,
  SourceProjectKey as ProjectKey,
} from '../observation/source.ts'
import type { GitHubProviderRead, ProjectConfiguration } from '../projects/registry.ts'
import { readApplicationState } from '../public-test-fixtures.ts'
import {
  controlledSourceFixture,
  createSourceFixtureOwner,
  type FixtureMap,
  type FixtureProject,
  type FixtureTicket,
} from '../source-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'

function project(
  key: ProjectKey,
  path: string,
  maps: readonly [string, TicketState][],
): FixtureProject {
  const openMaps: FixtureMap[] = maps.map(([id, state]) => {
    const ticket: FixtureTicket = {
      id: '1',
      displayId: '#1',
      title: 'Scoped ticket',
      ...(key.integration === 'local'
        ? { sourcePath: join(path, dirname(id), 'tickets/01-task.md') }
        : { url: 'https://github.com/acme/notifications/issues/1' }),
      body: '',
      typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
      state,
      isClaimed: state === 'claimed',
      isBlocked: false,
      createdAt: 1,
      ...(state === 'closed' ? { closedAt: 2 } : {}),
      assignees: [],
      blockedBy: [],
      blockersComplete: true,
      warnings: [],
    }
    return {
      project: key,
      id,
      displayId: id,
      title: 'Scoped map',
      ...(key.integration === 'local'
        ? { sourcePath: join(path, id) }
        : { url: `https://github.com/acme/notifications/issues/${id}` }),
      isOpen: true,
      updatedAt: 1,
      body: {
        raw: '',
        destination: '',
        notes: [],
        decisions: [],
        notYetSpecified: [],
        notYetSpecifiedNote: '',
        outOfScope: [],
        sections: [],
        missingSections: [],
      },
      tickets: [ticket],
      progress: { total: 1, completed: state === 'closed' ? 1 : 0 },
      ticketsComplete: true,
      warnings: [],
    }
  })
  return {
    key,
    name: key.id,
    ...(key.integration === 'local'
      ? { sourcePath: path }
      : { sourceUrl: 'https://github.com/acme/notifications' }),
    openMaps,
    closedMaps: [],
    warnings: [],
  }
}

async function harness(
  specs: readonly { key: ProjectKey; maps: readonly [string, TicketState][] }[],
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-notification-input-')))
  const projects = specs.map((spec, index) =>
    project(spec.key, join(root, String(index)), spec.maps),
  )
  for (const value of projects) {
    await mkdir(value.sourcePath ?? join(root, value.key.id), { recursive: true })
  }
  const configuration: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [
      { id: 'local', integration: 'local', name: 'Local', builtIn: true },
      {
        id: 'github',
        integration: 'github',
        name: 'GitHub',
        builtIn: false,
        githubIdentity: { id: '7', login: 'harmless-test' },
      },
    ],
    projects: projects.map((value, index) =>
      value.key.integration === 'local'
        ? {
            ref: { integration: 'local', projectId: value.key.id },
            connectionId: 'local',
            workspace: { path: value.sourcePath ?? join(root, String(index)) },
          }
        : {
            ref: { integration: 'github', projectId: value.key.id },
            connectionId: 'github',
            locator: { repositoryId: '101', nameWithOwner: 'acme/notifications' },
            workspace: { path: join(root, String(index)) },
          },
    ),
    automation: { enabled: false, enabledProjects: [] },
  }
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: configuration }
    },
    subscribe() {
      return () => undefined
    },
    async write() {
      throw new Error('Notification reads must not write configuration')
    },
    async stop() {},
  }
  const readers = projects.map(() => createSourceFixtureOwner())
  const sources = projects.map((value, index) => {
    const read = readers[index]
    if (!read) throw new Error('Missing fixture source reader')
    return controlledSourceFixture(value.key, read([value], 100, configuration))
  })
  const events: ChangeEvent[] = []
  const provider: GitHubProviderRead = {
    async restGet(path) {
      if (path !== '/repos/acme/notifications') throw new Error(`Unexpected provider read ${path}`)
      return { id: 101, full_name: 'acme/notifications' }
    },
    async graphql() {
      throw new Error('Controlled scoped observation does not query the provider')
    },
  }
  function observer(key: ProjectKey) {
    const found = sources.find(
      (_, index) =>
        projects[index]?.key.integration === key.integration && projects[index]?.key.id === key.id,
    )
    if (!found) throw new Error('Unexpected observation authority')
    return found.observer
  }
  const application = createRoadmapApplication({
    configuration: document,
    admissions: {
      local: createLocalProjectAdmission(),
      github: createGitHubProjectAdmission({
        async inspectWorkspace(path) {
          return { path, remotes: [{ name: 'origin', nameWithOwner: 'acme/notifications' }] }
        },
      }),
    },
    github: createGitHubConnectionPort({
      clientId: 'harmless',
      appSlug: 'harmless',
      fetch: async (input) => {
        if (String(input) !== 'https://api.github.com/user')
          throw new Error('Unexpected authorization request')
        return Response.json({ id: 7, login: 'harmless-test' })
      },
    }),
    providerRead: () => provider,
    credentialVault: {
      async read() {
        return {
          accessToken: 'harmless',
          refreshToken: 'harmless-refresh',
          accessTokenExpiresAt: Date.now() + 10_000_000,
          refreshTokenExpiresAt: Date.now() + 100_000_000,
        }
      },
      async write() {
        throw new Error('Unexpected credential mutation')
      },
      async delete() {
        throw new Error('Unexpected credential deletion')
      },
      async cleanupOrphans() {},
    },
    observers: {
      local: (input) => observer({ integration: 'local', id: input.ref.projectId }),
      github: (input) => observer({ integration: 'github', id: input.ref.projectId }),
    },
    onChangeEvents: (batch) => events.push(...batch),
  })
  try {
    await application.start()
  } catch (error) {
    await application.stop()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    application,
    projects,
    events,
    batch(index: number, maps: readonly [string, TicketState][], at: number) {
      const original = projects[index]
      const read = readers[index]
      if (!read) throw new Error('Missing fixture source reader')
      if (!original) throw new Error('Missing fixture project')
      return read(
        [project(original.key, original.sourcePath ?? join(root, String(index)), maps)],
        at,
        configuration,
      )
    },
    nextReadSequence(index: number) {
      const read = readers[index]
      if (!read) throw new Error('Missing fixture source reader')
      return read.nextReadSequence()
    },
    push(index: number, batch: ObservationBatch) {
      const source = sources[index]
      if (!source) throw new Error('Missing fixture source')
      source.push(batch)
    },
    async stop() {
      await application.stop()
      await rm(root, { recursive: true, force: true })
    },
  }
}

function failed(attempt: ObservationAttempt, attemptedAt: number): ObservationAttempt {
  return {
    kind: 'failed',
    readSequence: attempt.readSequence,
    scope: attempt.scope,
    attemptedAt,
    provenance: attempt.provenance,
    failure:
      attempt.provenance.integration === 'local'
        ? { kind: 'filesystem', operation: attempt.provenance.operation, code: 'EACCES' }
        : { kind: 'transient', cause: 'network' },
  }
}

function mapFailure(batch: ObservationBatch, mapId: string, at: number): ObservationBatch {
  return {
    attempts: batch.attempts.flatMap((attempt) => {
      if (attempt.scope.kind === 'map' && attempt.scope.map.mapId === mapId)
        return [failed(attempt, at)]
      if (attempt.scope.kind === 'tickets-membership' && attempt.scope.map.mapId === mapId)
        return []
      if (attempt.scope.kind === 'ticket' && attempt.scope.ticket.map.mapId === mapId) return []
      return [attempt]
    }),
  }
}

function ticketEvents(events: ChangeEvent[]) {
  return events.flatMap((event) =>
    'ticket' in event
      ? [
          {
            type: event.type,
            projectId: event.ticket.project.id,
            mapId: event.ticket.mapId,
            id: event.ticket.id,
          },
        ]
      : [],
  )
}

const LOCAL: ProjectKey = { integration: 'local', id: 'known-local' }
const MAP = '.wayfinder/map.md'

describe('public application notification inputs', () => {
  it.each(['local', 'github'] as const)(
    'does not announce a known %s map or frontier after unreadable then identical recovery',
    async (integration) => {
      const key: ProjectKey = {
        integration,
        id: integration === 'local' ? 'known-local' : 'known-github',
      }
      const mapId = integration === 'local' ? MAP : '108'
      const test = await harness([{ key, maps: [[mapId, 'frontier']] }])
      try {
        expect(
          readApplicationState(test.application.current()).projects[0]?.displayOrder.open.map(
            (ref) => ref.mapId,
          ),
        ).toEqual([mapId])
        expect(test.events).toEqual([])
        test.push(0, mapFailure(test.batch(0, [[mapId, 'frontier']], 200), mapId, 200))
        expect(test.events).toEqual([])
        test.push(0, test.batch(0, [[mapId, 'frontier']], 300))
        expect(
          readApplicationState(test.application.current()).projects[0]?.maps[0]?.tickets[0]
            ?.resource,
        ).toMatchObject({
          kind: 'current-readable',
          observation: { value: { state: 'frontier' } },
        })
        expect(test.events).toEqual([])
      } finally {
        await test.stop()
      }
    },
  )

  it.each(['claimed', 'closed'] as const)(
    'notifies a real ticket %s once when a failed map scope recovers',
    async (state) => {
      const test = await harness([{ key: LOCAL, maps: [[MAP, 'frontier']] }])
      try {
        test.push(0, mapFailure(test.batch(0, [[MAP, state]], 200), MAP, 200))
        expect(test.events).toEqual([])
        test.push(0, test.batch(0, [[MAP, state]], 300))
        test.push(0, test.batch(0, [[MAP, state]], 400))
        expect(ticketEvents(test.events)).toEqual([
          {
            type: state === 'claimed' ? 'ticket-claimed' : 'ticket-closed',
            projectId: 'known-local',
            mapId: '.wayfinder/map.md',
            id: '1',
          },
        ])
        expect(test.events.filter((event) => event.type === 'map-appeared')).toEqual([])
      } finally {
        await test.stop()
      }
    },
  )

  it.each(['failed', 'incomplete', 'complete'] as const)(
    'treats %s parent membership omission according to its absence evidence',
    async (mode) => {
      const test = await harness([{ key: LOCAL, maps: [[MAP, 'frontier']] }])
      try {
        const omitted = test.batch(0, [], 200)
        test.push(0, {
          attempts: omitted.attempts.map((attempt): ObservationAttempt => {
            if (attempt.kind !== 'observed' || attempt.scope.kind !== 'maps-membership')
              return attempt
            if (mode === 'failed') return failed(attempt, 200)
            return {
              ...attempt,
              completeness:
                mode === 'complete'
                  ? { kind: 'complete' }
                  : { kind: 'incomplete', reason: 'unreadable' },
            }
          }),
        })
        expect(test.events).toEqual([])
        test.push(0, test.batch(0, [[MAP, 'frontier']], 300))
        expect(test.events).toEqual(
          mode === 'complete'
            ? [
                {
                  type: 'map-appeared',
                  map: {
                    project: { integration: 'local', id: 'known-local' },
                    projectName: 'known-local',
                    id: '.wayfinder/map.md',
                    displayId: '.wayfinder/map.md',
                    title: 'Scoped map',
                  },
                },
              ]
            : [],
        )
      } finally {
        await test.stop()
      }
    },
  )

  it('commits readable sibling changes without forgetting an unreadable known map', async () => {
    const sibling = '.wayfinder/sibling/map.md'
    const test = await harness([
      {
        key: LOCAL,
        maps: [
          [MAP, 'frontier'],
          [sibling, 'frontier'],
        ],
      },
    ])
    try {
      test.push(
        0,
        mapFailure(
          test.batch(
            0,
            [
              [MAP, 'frontier'],
              [sibling, 'claimed'],
            ],
            200,
          ),
          MAP,
          200,
        ),
      )
      expect(ticketEvents(test.events)).toEqual([
        {
          type: 'ticket-claimed',
          projectId: 'known-local',
          mapId: '.wayfinder/sibling/map.md',
          id: '1',
        },
      ])
      test.push(
        0,
        test.batch(
          0,
          [
            [MAP, 'closed'],
            [sibling, 'claimed'],
          ],
          300,
        ),
      )
      expect(ticketEvents(test.events)).toEqual([
        {
          type: 'ticket-claimed',
          projectId: 'known-local',
          mapId: '.wayfinder/sibling/map.md',
          id: '1',
        },
        { type: 'ticket-closed', projectId: 'known-local', mapId: '.wayfinder/map.md', id: '1' },
      ])
      expect(test.events.filter((event) => event.type === 'map-appeared')).toEqual([])
    } finally {
      await test.stop()
    }
  })

  it('commits a readable ticket scope while its sibling ticket is unreadable', async () => {
    const test = await harness([{ key: LOCAL, maps: [[MAP, 'frontier']] }])
    try {
      function twoTickets(state: TicketState, at: number): ObservationBatch {
        const base = test.batch(0, [[MAP, state]], at)
        return {
          attempts: base.attempts.flatMap((attempt): ObservationAttempt[] => {
            if (attempt.kind !== 'observed') return [attempt]
            if (attempt.scope.kind === 'tickets-membership' && 'members' in attempt.value)
              return [
                {
                  kind: 'observed',
                  readSequence: attempt.readSequence,
                  scope: attempt.scope,
                  attemptedAt: at,
                  observedAt: at,
                  provenance: attempt.provenance,
                  completeness: { kind: 'complete' },
                  value: {
                    members: [
                      { map: attempt.scope.map, ticketId: '1' },
                      { map: attempt.scope.map, ticketId: '2' },
                    ],
                  },
                },
              ]
            if (attempt.scope.kind !== 'ticket' || !('isClaimed' in attempt.value)) return [attempt]
            const key = { ...attempt.scope.ticket, ticketId: '2' }
            if (attempt.value.source.kind !== 'file') throw new Error('Expected Local ticket path')
            return [
              attempt,
              {
                kind: 'observed',
                readSequence: test.nextReadSequence(0),
                scope: { kind: 'ticket', ticket: key },
                attemptedAt: at,
                observedAt: at,
                provenance: {
                  integration: 'local',
                  operation: 'read',
                  path: join(dirname(attempt.value.source.path), '02-task.md'),
                },
                completeness: { kind: 'complete' },
                value: {
                  ...attempt.value,
                  key,
                  displayId: '#2',
                  title: 'Unreadable sibling',
                  source: {
                    kind: 'file',
                    path: join(dirname(attempt.value.source.path), '02-task.md'),
                  },
                  status: 'open',
                  isClaimed: false,
                },
              },
            ]
          }),
        }
      }
      test.push(0, twoTickets('frontier', 200))
      test.events.length = 0
      const partial = twoTickets('claimed', 300)
      test.push(0, {
        attempts: partial.attempts.map((attempt) =>
          attempt.scope.kind === 'ticket' && attempt.scope.ticket.ticketId === '2'
            ? failed(attempt, 300)
            : attempt,
        ),
      })
      expect(ticketEvents(test.events)).toEqual([
        { type: 'ticket-claimed', projectId: 'known-local', mapId: '.wayfinder/map.md', id: '1' },
      ])
      test.push(0, twoTickets('claimed', 400))
      expect(ticketEvents(test.events)).toHaveLength(1)
      expect(test.events.filter((event) => event.type === 'map-appeared')).toEqual([])
    } finally {
      await test.stop()
    }
  })

  it('notifies both same-number tickets scoped to two maps in one Local Project', async () => {
    const second = '.wayfinder/second/map.md'
    const test = await harness([
      {
        key: LOCAL,
        maps: [
          [MAP, 'frontier'],
          [second, 'frontier'],
        ],
      },
    ])
    try {
      test.push(
        0,
        test.batch(
          0,
          [
            [MAP, 'closed'],
            [second, 'claimed'],
          ],
          200,
        ),
      )
      expect(ticketEvents(test.events)).toEqual([
        { type: 'ticket-closed', projectId: 'known-local', mapId: '.wayfinder/map.md', id: '1' },
        {
          type: 'ticket-claimed',
          projectId: 'known-local',
          mapId: '.wayfinder/second/map.md',
          id: '1',
        },
      ])
    } finally {
      await test.stop()
    }
  })

  it('does not merge colon-colliding opaque Project and map identities', async () => {
    const test = await harness([
      { key: { integration: 'local', id: 'opaque:map:branch' }, maps: [[MAP, 'frontier']] },
      {
        key: { integration: 'local', id: 'opaque' },
        maps: [['branch:map:.wayfinder/map.md', 'frontier']],
      },
    ])
    try {
      expect(readApplicationState(test.application.current()).projects).toHaveLength(2)
      test.push(0, test.batch(0, [[MAP, 'closed']], 200))
      test.push(1, test.batch(1, [['branch:map:.wayfinder/map.md', 'claimed']], 300))
      expect(ticketEvents(test.events)).toEqual([
        {
          type: 'ticket-closed',
          projectId: 'opaque:map:branch',
          mapId: '.wayfinder/map.md',
          id: '1',
        },
        {
          type: 'ticket-claimed',
          projectId: 'opaque',
          mapId: 'branch:map:.wayfinder/map.md',
          id: '1',
        },
      ])
      expect(test.events.filter((event) => event.type === 'map-appeared')).toEqual([])
    } finally {
      await test.stop()
    }
  })
})
