import type { Blocker } from '@roadmap/contracts'
import { applicationStateCodec } from '@roadmap/contracts/codecs'
import { describe, expect, test } from 'vitest'

const project = { integration: 'github', id: 'owner/repo' }

function applicationWithBlocker(blocker: unknown) {
  const ticket = {
    id: '2',
    body: '',
    typeEvidence: { kind: 'missing', labels: [] },
    state: 'blocked',
    isClaimed: false,
    isBlocked: true,
    assignees: [],
    blockedBy: [blocker],
    blockersComplete: true,
    warnings: [],
  }
  return {
    serverEpoch: 'test',
    stateSequence: 0,
    configurationVersion: 0,
    supportedIntegrations: [],
    connections: [],
    registrations: [],
    projects: [],
    authorizationOperations: [],
    configuration: { valid: true, issues: [], notices: [] },
    automation: {
      enabled: false,
      enabledProjects: [],
      availability: { status: 'ready' },
      evidence: [],
      overrides: [],
    },
    roadmap: {
      capturedAt: 1,
      unreachable: [],
      projects: [
        {
          key: project,
          name: 'owner/repo',
          warnings: [],
          closedMaps: [],
          openMaps: [
            {
              project,
              id: '1',
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
              frontier: [],
              progress: { total: 1, completed: 0 },
              ticketsComplete: true,
              warnings: [],
            },
          ],
        },
      ],
    },
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
