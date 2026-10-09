import type { Blocker } from '@roadmap/contracts'
import { applicationStateCodec } from '@roadmap/contracts/codecs'
import { describe, expect, test } from 'vitest'

const project = { integration: 'github', id: 'owner/repo' }

function applicationWithBlocker(blocker: unknown) {
  const blockerState =
    typeof blocker === 'object' && blocker !== null && 'state' in blocker
      ? blocker.state
      : undefined
  const isBlocked = blockerState !== 'closed'
  const map = { project, mapId: '1' }
  const ticketKey = { map, ticketId: '2' }
  const provenance = {
    integration: 'github',
    connectionId: 'github',
    repositoryId: '42',
    stage: 'map-read',
  }
  const common = { attemptedAt: 1, observedAt: 1, provenance, completeness: { kind: 'complete' } }
  const ticket = {
    key: ticketKey,
    resource: {
      kind: 'current-readable',
      observation: {
        ...common,
        scope: { kind: 'ticket', ticket: ticketKey },
        value: {
          source: { kind: 'issue', url: 'https://github.com/owner/repo/issues/2' },
          status: 'open',
          body: '',
          typeEvidence: { kind: 'missing', labels: [] },
          state: isBlocked ? 'blocked' : 'frontier',
          isClaimed: false,
          isBlocked,
          assignees: [],
          blockedBy: [blocker],
          blockersComplete: true,
          warnings: [],
        },
      },
    },
  }
  return {
    serverEpoch: 'test',
    stateSequence: 0,
    configurationVersion: 0,
    supportedIntegrations: [],
    connections: [],
    registrations: [],
    projects: [
      {
        key: project,
        connectionId: 'github',
        locator: { integration: 'github', repositoryId: '42', nameWithOwner: 'owner/repo' },
        workspace: { path: '/fixture' },
        name: 'owner/repo',
        actions: [],
        managementWarnings: [],
        resource: {
          kind: 'current-readable',
          observation: {
            ...common,
            provenance: { ...provenance, stage: 'repository' },
            scope: { kind: 'project', project },
            value: {
              name: 'owner/repo',
              source: {
                integration: 'github',
                repositoryId: '42',
                nameWithOwner: 'owner/repo',
                url: 'https://github.com/owner/repo',
              },
              warnings: [],
            },
          },
        },
        mapsMembership: {
          kind: 'current-complete',
          observation: {
            ...common,
            provenance: { ...provenance, stage: 'map-list' },
            scope: { kind: 'maps-membership', project },
            value: { members: [map] },
          },
        },
        maps: [
          {
            key: map,
            resource: {
              kind: 'current-readable',
              observation: {
                ...common,
                scope: { kind: 'map', map },
                value: {
                  source: { kind: 'issue', url: 'https://github.com/owner/repo/issues/1' },
                  status: 'open',
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
                  progress: { total: 1, completed: 0 },
                  warnings: [],
                },
              },
            },
            ticketsMembership: {
              kind: 'current-complete',
              observation: {
                ...common,
                scope: { kind: 'tickets-membership', map },
                value: { members: [ticketKey] },
              },
            },
            tickets: [ticket],
          },
        ],
        displayOrder: { openMapIds: ['1'], closedMapIds: [] },
        activeMap:
          blockerState === 'unknown'
            ? {
                kind: 'uncertain',
                reason: 'map-incomplete',
                cause: 'A map required for ordering is incomplete.',
              }
            : { kind: 'known-current', mapId: '1' },
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
    roadmap: { capturedAt: 1 },
  }
}

const external = {
  reference: {
    kind: 'external',
    integration: 'github',
    nameWithOwner: 'owner/repo',
    repositoryId: '42',
  },
  ticketId: '2',
  displayId: '#2',
  title: 'Dependency',
  state: 'closed',
  url: 'https://github.com/owner/repo/issues/2',
} satisfies Blocker

describe('application blocker boundary', () => {
  test('round-trips an external name collision without minting an admitted key', () => {
    const input = applicationWithBlocker(external)
    const result = applicationStateCodec.decode(JSON.parse(JSON.stringify(input)))
    expect(result).toEqual({ ok: true, value: input })
    if (!result.ok) throw new Error('Expected external blocker to decode')
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(input)
  })

  test.each(['github', 'local'])(
    'retains the scoped identity of a registered %s blocker',
    (integration) => {
      const input = applicationWithBlocker({
        reference: { kind: 'registered', project: { integration, id: 'opaque' } },
        ticketId: '2',
        state: 'unknown',
      })
      expect(applicationStateCodec.decode(input)).toEqual({ ok: true, value: input })
    },
  )

  test('preserves unresolved locator and unknown state', () => {
    const blocker = {
      reference: { kind: 'unresolved', locator: '../other' },
      ticketId: '7',
      state: 'unknown',
    } satisfies Blocker
    const input = applicationWithBlocker(blocker)
    expect(applicationStateCodec.decode(input)).toEqual({ ok: true, value: input })
  })

  test('accepts external references without optional repository identity', () => {
    const blocker = {
      reference: { kind: 'external', integration: 'github', nameWithOwner: 'other/repo' },
      ticketId: '7',
      state: 'open',
    } satisfies Blocker
    const input = applicationWithBlocker(blocker)
    expect(applicationStateCodec.decode(input)).toEqual({ ok: true, value: input })
  })

  test.each([
    { ...external, state: 'deleted' },
    { ...external, ticketId: 7 },
    {
      ...external,
      reference: { kind: 'registered', project: { integration: 'other', id: 'opaque' } },
    },
    { ...external, reference: { kind: 'registered', project: { integration: 'local', id: 7 } } },
    {
      ...external,
      reference: {
        kind: 'registered',
        project: { integration: 'local', id: 'opaque', extra: true },
      },
    },
    { ...external, reference: { ...external.reference, integration: 'local' } },
    { ...external, reference: { ...external.reference, repositoryId: 42 } },
    { ...external, reference: { kind: 'external', integration: 'github' } },
    { ...external, reference: { kind: 'unresolved' } },
    { ...external, reference: { kind: 'unresolved', locator: '../other', project } },
    { ...external, reference: { ...external.reference, project } },
    { ...external, reference: { ...external.reference, locator: '../other' } },
    { ...external, project },
    { ...external, unexpected: true },
    { ...external, reference: { ...external.reference, unexpected: true } },
    { ticketId: '7', state: 'open' },
  ])('refuses contradictory identity or undeclared blocker fields %#', (blocker) => {
    expect(applicationStateCodec.decode(applicationWithBlocker(blocker)).ok).toBe(false)
  })

  test('refuses the obsolete project-only blocker format', () => {
    expect(
      applicationStateCodec.decode(
        applicationWithBlocker({
          project,
          ticketId: '2',
          state: 'closed',
        }),
      ).ok,
    ).toBe(false)
  })
})
