import { type CorrelationId, correlationIdSchema } from '@roadmap/contracts/identity'
import { queryResultSchema, querySchema } from '@roadmap/contracts/operations'
import {
  authorizationOperationSchema,
  automationEvidenceSchema,
  connectionSchema,
  projectActionSchema,
  ticketTypeEvidenceSchema,
  wayfinderSessionSchema,
} from '@roadmap/contracts/state'
import {
  decodeApplicationState,
  decodeQueryResultEnvelope,
  decodeStateEnvelope,
  requestIdSchema,
} from '@roadmap/contracts/wire'
import { describe, expect, test } from 'vitest'

const projectRef = { integration: 'github', projectId: 'opaque/project' }
const mapRef = { project: projectRef, mapId: '1' }
const ticketRef = { map: mapRef, ticketId: '2' }
const external = {
  reference: {
    kind: 'external',
    integration: 'github',
    nameWithOwner: 'owner/repo',
    repositoryId: '42',
    ticketId: '7',
  },
  state: 'closed',
  url: 'https://github.com/owner/repo/issues/7',
}
const connection = {
  id: 'github',
  integration: 'github',
  builtIn: false,
  name: 'GitHub',
  githubIdentity: { id: '123', login: 'owner' },
  availability: { status: 'unavailable', cause: 'Connection health is independent.' },
}
const provenance = {
  integration: 'github',
  connectionId: 'github',
  repositoryId: '42',
  stage: 'map-read',
}
const common = { attemptedAt: 1, observedAt: 1, provenance, completeness: { kind: 'complete' } }
const afk = {
  status: 'completed',
  admission: 'automatic',
  processResult: { status: 'exited', code: 1 },
  verdict: { value: 'afk', reason: 'Actual Classification report.' },
}

function applicationWithBlocker(
  blocker: unknown = external,
  typeEvidence: unknown = { kind: 'missing', labels: [] },
) {
  const blockerState =
    typeof blocker === 'object' && blocker !== null && 'state' in blocker
      ? blocker.state
      : undefined
  const isBlocked = blockerState !== 'closed'
  const ticket = {
    ref: ticketRef,
    resource: {
      kind: 'current-readable',
      observation: {
        ...structuredClone(common),
        scope: { kind: 'ticket', ticket: ticketRef },
        value: {
          source: { kind: 'issue', url: 'https://github.com/owner/repo/issues/2' },
          status: 'open',
          body: 'Actual ticket prose.',
          typeEvidence,
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
  const map = {
    ref: mapRef,
    resource: {
      kind: 'current-readable',
      observation: {
        ...structuredClone(common),
        scope: { kind: 'map', map: mapRef },
        value: {
          source: { kind: 'issue', url: 'https://github.com/owner/repo/issues/1' },
          status: 'open',
          updatedAt: 1,
          body: {
            raw: '# Actual map prose',
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
        ...structuredClone(common),
        scope: { kind: 'tickets-membership', map: mapRef },
        value: { members: [ticketRef] },
      },
    },
    tickets: [ticket],
    frontier: isBlocked ? [] : [ticketRef],
  }
  const project = {
    integration: 'github',
    ref: projectRef,
    connectionId: 'github',
    source: {
      integration: 'github',
      repositoryId: '42',
      nameWithOwner: 'owner/repo',
      url: 'https://github.com/owner/repo',
    },
    management: { workspacePath: '/fixture' },
    name: 'owner/repo',
    actions: [],
    managementWarnings: [],
    resource: {
      kind: 'current-readable',
      observation: {
        ...structuredClone(common),
        provenance: { ...provenance, stage: 'repository' },
        scope: { kind: 'project', project: projectRef },
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
        ...structuredClone(common),
        provenance: { ...provenance, stage: 'map-list' },
        scope: { kind: 'maps-membership', project: projectRef },
        value: { members: [mapRef] },
      },
    },
    maps: [map],
    displayOrder: { open: [mapRef], closed: [] },
    activeMap:
      blockerState === 'unknown'
        ? {
            kind: 'uncertain',
            reason: 'map-incomplete',
            cause: 'A map required for ordering is incomplete.',
          }
        : { kind: 'known-current', ref: mapRef },
  }
  return structuredClone({
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: 'test',
    stateSequence: 0,
    capturedAt: 1,
    configurationVersion: 1,
    supportedIntegrations: [],
    connections: [connection],
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
  })
}

function canonical(input: ReturnType<typeof applicationWithBlocker>) {
  const project = input.projects[0]
  const map = project?.maps[0]
  const ticket = map?.tickets[0]
  if (!project || !map || !ticket) throw new Error('Fixture requires canonical resources')
  return { project, map, ticket }
}

function rejects(input: unknown, path: string) {
  const result = decodeApplicationState(input)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected public state refusal')
  expect(result.issues.some((issue) => issue.path.includes(path))).toBe(true)
}

describe('whole-state canonical identity', () => {
  test('accepts exact state with Connection health independent of readable resources', () => {
    const input = applicationWithBlocker()
    expect(decodeApplicationState(JSON.parse(JSON.stringify(input)))).toEqual({
      ok: true,
      value: input,
    })
  })
  test('rejects absent canonical Connection', () => {
    const input = applicationWithBlocker()
    input.connections = []
    rejects(input, 'connectionId')
  })
  test('rejects wrong Integration association', () => {
    const input = applicationWithBlocker()
    Reflect.set(input.connections, 0, {
      id: 'github',
      integration: 'local',
      builtIn: true,
      name: 'Local',
      availability: { status: 'available' },
    })
    rejects(input, 'connectionId')
  })
  test('rejects duplicate Connection identities', () => {
    const input = applicationWithBlocker()
    input.connections.push(connection)
    rejects(input, 'connections')
  })
  test('rejects duplicate canonical account identities', () => {
    const input = applicationWithBlocker()
    input.connections.push({ ...connection, id: 'another' })
    rejects(input, 'githubIdentity')
  })
  test('rejects duplicate scoped Project identities', () => {
    const input = applicationWithBlocker()
    input.projects.push(canonical(input).project)
    rejects(input, 'projects')
  })
  test('rejects duplicate canonical map identities', () => {
    const input = applicationWithBlocker()
    const { project, map } = canonical(input)
    project.maps.push(map)
    rejects(input, 'maps')
  })
  test('rejects duplicate canonical ticket identities', () => {
    const input = applicationWithBlocker()
    const { map, ticket } = canonical(input)
    map.tickets.push(ticket)
    rejects(input, 'tickets')
  })
  test('rejects Project source/provenance binding disagreement', () => {
    const input = applicationWithBlocker()
    canonical(input).project.source.repositoryId = 'different'
    rejects(input, 'resource')
  })
  test('rejects cross-parent map identity', () => {
    const input = applicationWithBlocker()
    canonical(input).map.ref = { ...mapRef, project: { ...projectRef, projectId: 'another' } }
    rejects(input, 'maps')
  })
  test('rejects cross-parent ticket identity', () => {
    const input = applicationWithBlocker()
    canonical(input).ticket.ref = { ...ticketRef, map: { ...mapRef, mapId: 'another' } }
    rejects(input, 'tickets')
  })
  test('rejects duplicate map membership', () => {
    const input = applicationWithBlocker()
    canonical(input).project.mapsMembership.observation.value.members.push(mapRef)
    rejects(input, 'members')
  })
  test('rejects duplicate ticket membership', () => {
    const input = applicationWithBlocker()
    canonical(input).map.ticketsMembership.observation.value.members.push(ticketRef)
    rejects(input, 'members')
  })
  test('rejects missing canonical member resource', () => {
    const input = applicationWithBlocker()
    canonical(input).map.tickets = []
    rejects(input, 'members')
  })
  test('rejects closed map in open placement', () => {
    const input = applicationWithBlocker()
    canonical(input).map.resource.observation.value.status = 'closed'
    rejects(input, 'displayOrder')
  })
  test('rejects frontier outside its parent map', () => {
    const input = applicationWithBlocker()
    canonical(input).map.frontier = [{ ...ticketRef, map: { ...mapRef, mapId: 'other' } }]
    rejects(input, 'frontier')
  })
  test('rejects omitted eligible frontier ticket', () => {
    const input = applicationWithBlocker()
    canonical(input).map.frontier = []
    rejects(input, 'frontier')
  })
  test('rejects claimed ticket in frontier', () => {
    const input = applicationWithBlocker()
    const { ticket } = canonical(input)
    ticket.resource.observation.value.isClaimed = true
    ticket.resource.observation.value.state = 'claimed'
    rejects(input, 'frontier')
  })
})

describe('ticket type and independent facts', () => {
  test.each([
    { kind: 'missing', labels: [] },
    { kind: 'recognized', value: 'task', labels: ['task'] },
    { kind: 'unknown', labels: ['custom'] },
    { kind: 'unknown', labels: [''] },
    { kind: 'conflicting', labels: ['custom', 'task'] },
  ])('accepts legitimate type evidence %#', (evidence) => {
    expect(decodeApplicationState(applicationWithBlocker(external, evidence)).ok).toBe(true)
  })
  test.each([
    { kind: 'missing', labels: ['task'] },
    { kind: 'missing' },
    { kind: 'recognized', value: 'task', labels: ['research'] },
    { kind: 'recognized', value: 'task', labels: [] },
    { kind: 'unknown', labels: [] },
    { kind: 'unknown', labels: ['task'] },
    { kind: 'conflicting', labels: ['task'] },
    { kind: 'conflicting', labels: ['task', 'task'] },
  ])('rejects contradictory or incomplete evidence %#', (evidence) => {
    expect(decodeApplicationState(applicationWithBlocker(external, evidence)).ok).toBe(false)
  })
  test('accepts claimed and blocked at the same time', () => {
    const input = applicationWithBlocker({ ...external, state: 'open' })
    canonical(input).ticket.resource.observation.value.isClaimed = true
    expect(decodeApplicationState(input).ok).toBe(true)
  })
  test('accepts unknown external blocker without frontier promotion', () => {
    const input = applicationWithBlocker({ ...external, state: 'unknown' })
    expect(decodeApplicationState(input).ok).toBe(true)
    expect(canonical(input).map.frontier).toEqual([])
  })
  test('accepts incomplete upstream counts beyond fetched tickets', () => {
    const input = applicationWithBlocker()
    const { project, map } = canonical(input)
    map.resource.observation.completeness.kind = 'incomplete'
    Reflect.set(map.resource.observation.completeness, 'reason', 'pagination')
    map.resource.observation.value.progress = { total: 100, completed: 80 }
    project.activeMap = {
      kind: 'uncertain',
      reason: 'map-incomplete',
      cause: 'A map required for ordering is incomplete.',
    }
    expect(decodeApplicationState(input).ok).toBe(true)
  })
  test('refuses inconsistent independent blocked fact', () => {
    const input = applicationWithBlocker()
    canonical(input).ticket.resource.observation.value.isBlocked = true
    rejects(input, 'isBlocked')
  })
  test('preserves trustworthy historical placement under current incomplete status', () => {
    const input = applicationWithBlocker()
    const { project, map } = canonical(input)
    map.resource.observation.completeness.kind = 'incomplete'
    Reflect.set(map.resource.observation.completeness, 'reason', 'malformed')
    map.resource.observation.value.status = 'closed'
    project.activeMap = {
      kind: 'uncertain',
      reason: 'map-incomplete',
      cause: 'A map required for ordering is incomplete.',
    }
    expect(decodeApplicationState(input).ok).toBe(true)
  })
})

describe('blocker references', () => {
  test.each([
    {
      reference: {
        kind: 'registered',
        ticket: {
          map: { project: { integration: 'local', projectId: 'absent' }, mapId: 'opaque' },
          ticketId: '7',
        },
      },
      state: 'unknown',
    },
    { reference: { kind: 'unresolved', locator: '../other', ticketId: '7' }, state: 'unknown' },
    {
      reference: {
        kind: 'external',
        integration: 'github',
        nameWithOwner: 'other/repo',
        ticketId: '7',
      },
      state: 'open',
    },
  ])('preserves independent reference scope and blocker state %#', (blocker) => {
    expect(decodeApplicationState(applicationWithBlocker(blocker)).ok).toBe(true)
  })
  test.each([
    { ...external, state: 'deleted' },
    { ...external, ticketId: '7' },
    { ...external, reference: { kind: 'registered', project: projectRef } },
    { ...external, reference: { kind: 'registered', ticket: { ticketId: '7' } } },
    { ...external, reference: { kind: 'unresolved' } },
    { ...external, reference: { ...external.reference, project: projectRef } },
    { ...external, token: 'private-value' },
  ])('rejects stale or extra blocker fields %#', (blocker) => {
    expect(decodeApplicationState(applicationWithBlocker(blocker)).ok).toBe(false)
  })
})

describe('Automation replay correspondence', () => {
  test.each([
    { status: 'running', admission: 'automatic' },
    { ...afk, verdict: { value: 'hitl', reason: 'Not AFK.' } },
    { status: 'launch-failed', admission: 'override', reason: 'Actual failure.' },
  ])('rejects a Session without completed AFK Classification %#', (classification) => {
    const input = applicationWithBlocker()
    Reflect.set(input.automation, 'evidence', [
      { target: ticketRef, classification, wayfinder: { status: 'queued' } },
    ])
    rejects(input, 'automation')
  })
  test('rejects completed AFK Classification without its queued or later Session', () => {
    const input = applicationWithBlocker()
    Reflect.set(input.automation, 'evidence', [{ target: ticketRef, classification: afk }])
    rejects(input, 'automation')
    expect(decodeStateEnvelope({ type: 'state', state: input }).ok).toBe(false)
  })
  test.each(['hitl', 'unable'])(
    'accepts completed %s Classification without a Session',
    (value) => {
      const input = applicationWithBlocker()
      Reflect.set(input.automation, 'evidence', [
        {
          target: ticketRef,
          classification: { ...afk, verdict: { value, reason: 'No Session is queued.' } },
        },
      ])
      expect(decodeApplicationState(input).ok).toBe(true)
    },
  )
  test('accepts queued without admission for an absent durable target', () => {
    const input = applicationWithBlocker()
    Reflect.set(input.automation, 'evidence', [
      {
        target: { ...ticketRef, ticketId: 'absent' },
        classification: afk,
        wayfinder: { status: 'queued' },
      },
    ])
    expect(decodeApplicationState(input).ok).toBe(true)
  })
  test('rejects queued admission', () => {
    expect(
      automationEvidenceSchema.safeParse({
        target: ticketRef,
        classification: afk,
        wayfinder: { status: 'queued', admission: 'automatic' },
      }).success,
    ).toBe(false)
  })
  test('rejects an explicitly undefined queued admission through Session and full-state schemas', () => {
    const wayfinder: unknown = { status: 'queued', admission: undefined }
    expect(wayfinderSessionSchema.safeParse(wayfinder).success).toBe(false)
    const input = applicationWithBlocker()
    Reflect.set(input.automation, 'evidence', [
      { target: ticketRef, classification: afk, wayfinder },
    ])
    expect(decodeApplicationState(input).ok).toBe(false)
  })
  test.each([
    { status: 'queued', admission: 'automatic' },
    { status: 'launching' },
    { status: 'running' },
    { status: 'finished', admission: 'automatic', processResult: { status: 'exited', code: 0 } },
    { status: 'outcome-unknown', admission: 'automatic', reason: 'Interrupted.' },
  ])('refuses phase-invalid Session payload through full-state decoder %#', (wayfinder) => {
    const input = applicationWithBlocker()
    Reflect.set(input.automation, 'evidence', [
      { target: ticketRef, classification: afk, wayfinder },
    ])
    expect(decodeApplicationState(input).ok).toBe(false)
  })
  test('accepts independent failed Process and completed Session report without closed tracker', () => {
    const input = applicationWithBlocker()
    Reflect.set(input.automation, 'evidence', [
      {
        target: ticketRef,
        classification: afk,
        wayfinder: {
          status: 'finished',
          admission: 'override',
          processResult: { status: 'exited', code: 1 },
          report: {
            status: 'received',
            report: { outcome: 'completed', reason: 'Actual report.' },
          },
        },
      },
    ])
    expect(decodeApplicationState(input).ok).toBe(true)
  })
  test('acknowledged outcome stays unknown', () => {
    const input = applicationWithBlocker()
    Reflect.set(input.automation, 'evidence', [
      {
        target: ticketRef,
        classification: afk,
        wayfinder: {
          status: 'outcome-unknown',
          admission: 'automatic',
          acknowledged: true,
          reason: 'Interrupted.',
        },
      },
    ])
    const decoded = decodeApplicationState(input)
    expect(decoded.ok).toBe(true)
    if (decoded.ok && decoded.value.phase === 'ready')
      expect(decoded.value.automation.evidence[0]?.wayfinder?.status).toBe('outcome-unknown')
  })
})

describe('strict public variants and own data', () => {
  test('requires a branded UUID for call-local operation correlation', () => {
    const input = '1a82c8e3-70de-4165-a243-78dfce0d90a2'
    const correlationId: CorrelationId = correlationIdSchema.parse(input)
    expect(correlationId).toBe(input)
    expect(requestIdSchema.safeParse(input).success).toBe(true)
    for (const invalid of ['call-1', '']) {
      expect(correlationIdSchema.safeParse(invalid).success).toBe(false)
      expect(requestIdSchema.safeParse(invalid).success).toBe(false)
    }
  })
  test.each([
    { id: 'link', label: 'Link', kind: 'external-link' },
    { id: 'launch', label: 'Launch', kind: 'server-launch' },
    {
      id: 'launch',
      label: 'Launch',
      kind: 'server-launch',
      project: projectRef,
      operation: 'execute-shell',
    },
  ])('rejects missing or unsupported action payload %#', (input) =>
    expect(projectActionSchema.safeParse(input).success).toBe(false),
  )
  test.each([
    { id: 'auth', status: 'waiting' },
    { id: 'auth', status: 'granted' },
    { id: 'auth', status: 'terminal', outcome: 'failed' },
  ])('rejects missing authorization payload %#', (input) =>
    expect(authorizationOperationSchema.safeParse(input).success).toBe(false),
  )
  test.each([
    { id: 'link', label: 'Link', kind: 'external-link' },
    { id: 'launch', label: 'Launch', kind: 'server-launch' },
  ])('refuses action payload gaps through full-state decoder %#', (action) => {
    const input = applicationWithBlocker()
    Reflect.set(canonical(input).project, 'actions', [action])
    expect(decodeApplicationState(input).ok).toBe(false)
  })
  test.each([
    { id: 'auth', status: 'waiting' },
    { id: 'auth', status: 'granted' },
    { id: 'auth', status: 'terminal', outcome: 'failed' },
  ])('refuses authorization payload gaps through full-state decoder %#', (operation) => {
    const input = applicationWithBlocker()
    Reflect.set(input, 'authorizationOperations', [operation])
    expect(decodeApplicationState(input).ok).toBe(false)
  })
  test('rejects Integration-specific Connection identity mismatch', () => {
    expect(
      connectionSchema.safeParse({ ...connection, integration: 'local', builtIn: true }).success,
    ).toBe(false)
  })
  test.each([
    { id: 'link', label: 'Link', kind: 'external-link', href: 'https://github.com/owner/repo' },
    { id: 'route', label: 'Roadmap', kind: 'roadmap', href: '/projects/github/opaque%2Fproject' },
    {
      id: 'launch',
      label: 'Launch',
      kind: 'server-launch',
      project: projectRef,
      operation: 'open-workspace',
    },
  ])('accepts actual usable action variants %#', (input) =>
    expect(projectActionSchema.safeParse(input).success).toBe(true),
  )
  test.each([
    {
      id: 'auth',
      status: 'waiting',
      verificationUri: 'https://github.com/login/device',
      userCode: 'CODE',
      expiresAt: 2,
    },
    {
      id: 'auth',
      status: 'granted',
      connection: { kind: 'current', id: 'github', accountId: '123' },
    },
    { id: 'auth', status: 'terminal', outcome: 'cancelled' },
    { id: 'auth', status: 'terminal', outcome: 'expired' },
    { id: 'auth', status: 'terminal', outcome: 'denied', cause: 'Access denied.' },
    { id: 'auth', status: 'terminal', outcome: 'failed', cause: 'Authorization failed.' },
  ])('accepts phase-correct authorization variants %#', (input) =>
    expect(authorizationOperationSchema.safeParse(input).success).toBe(true),
  )
  test.each([
    { id: 'auth', status: 'terminal', outcome: 'cancelled' },
    { id: 'auth', status: 'terminal', outcome: 'expired' },
    { id: 'auth', status: 'terminal', outcome: 'denied', cause: 'Access denied.' },
    { id: 'auth', status: 'terminal', outcome: 'failed', cause: 'Authorization failed.' },
  ])('preserves terminal authorization request subject without current access %#', (operation) => {
    for (const connectionId of ['github', 'removed-connection']) {
      const terminal = { ...operation, connectionId }
      expect(authorizationOperationSchema.safeParse(terminal).success).toBe(true)
      const input = applicationWithBlocker()
      Reflect.set(input, 'authorizationOperations', [terminal])
      expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
      for (const verification of [
        { verificationUri: 'https://github.com/login/device' },
        { userCode: 'CODE' },
        { expiresAt: 2 },
      ]) {
        const invalid = { ...terminal, ...verification }
        expect(authorizationOperationSchema.safeParse(invalid).success).toBe(false)
        Reflect.set(input, 'authorizationOperations', [invalid])
        expect(decodeApplicationState(input).ok).toBe(false)
      }
    }
    const input = applicationWithBlocker()
    Reflect.set(input, 'connections', [
      ...input.connections,
      {
        id: 'local',
        integration: 'local',
        builtIn: true,
        name: 'Local',
        availability: { status: 'available' },
      },
    ])
    Reflect.set(input, 'authorizationOperations', [{ ...operation, connectionId: 'local' }])
    rejects(input, 'connectionId')
  })
  test('rejects current grant to a Connection not canonical in the state', () => {
    const input = applicationWithBlocker()
    Reflect.set(input, 'authorizationOperations', [
      {
        id: 'auth',
        status: 'granted',
        connection: { kind: 'current', id: 'absent', accountId: '123' },
      },
    ])
    rejects(input, 'connection')
  })
  test('rejects current grant to the wrong canonical account', () => {
    const input = applicationWithBlocker()
    Reflect.set(input, 'authorizationOperations', [
      {
        id: 'auth',
        status: 'granted',
        connection: { kind: 'current', id: 'github', accountId: 'other' },
      },
    ])
    rejects(input, 'connection')
  })
  test('rejects historical grant while its same canonical account is current', () => {
    const input = applicationWithBlocker()
    Reflect.set(input, 'authorizationOperations', [
      {
        id: 'auth',
        status: 'granted',
        connection: { kind: 'historical', id: 'github', accountId: '123' },
      },
    ])
    rejects(input, 'connection')
  })
  test.each([
    { id: 'absent', accountId: '123' },
    { id: 'github', accountId: 'previous-account' },
  ])('preserves actual grant receipt after removal or rebinding %#', (receipt) => {
    const input = applicationWithBlocker()
    Reflect.set(input, 'authorizationOperations', [
      { id: 'auth', status: 'granted', connection: { kind: 'historical', ...receipt } },
    ])
    expect(decodeApplicationState(input).ok).toBe(true)
  })
  test('rejects Integration/source mismatch', () => {
    const input = applicationWithBlocker()
    Reflect.set(canonical(input).project, 'source', { integration: 'local', path: '/fixture' })
    expect(decodeApplicationState(input).ok).toBe(false)
  })
  test('rejects missing required nested scopes', () => {
    const input = applicationWithBlocker()
    Reflect.set(canonical(input).ticket, 'ref', { ticketId: '2' })
    expect(decodeApplicationState(input).ok).toBe(false)
  })
  test('rejects a secret field within current resource value', () => {
    const input = applicationWithBlocker()
    Reflect.set(canonical(input).ticket.resource.observation.value, 'token', 'private-value')
    const result = decodeApplicationState(input)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('private-value')
  })
  test('accepts read-only readiness independently of source readability', () => {
    const input = applicationWithBlocker()
    input.mode = 'read-only'
    input.configuration.valid = false
    expect(decodeApplicationState(input).ok).toBe(true)
  })
  test('rejects partial retained evidence on terminal states', () => {
    expect(
      decodeApplicationState({
        phase: 'stopped',
        serverEpoch: 'test',
        stateSequence: 1,
        capturedAt: 2,
        retained: { phase: 'ready', projects: [] },
      }).ok,
    ).toBe(false)
  })
  test('keeps failed startup separate from ready and permits no previous baseline', () => {
    const input = {
      phase: 'failed',
      serverEpoch: 'test',
      stateSequence: 0,
      capturedAt: 1,
      cause: 'Application startup failed.',
      retained: null,
    }
    expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
  })
  test('rejects contradictory read-only mode', () => {
    const input = applicationWithBlocker()
    input.mode = 'read-only'
    rejects(input, 'mode')
  })
  test('preserves complete terminal evidence without terminal readiness', () => {
    const retained = applicationWithBlocker()
    const input = {
      phase: 'stopped',
      serverEpoch: 'test',
      stateSequence: 1,
      capturedAt: 2,
      retained,
    }
    expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
  })
  test.each(['idle', 'starting'])('accepts %s without partially initialized facts', (phase) => {
    expect(
      decodeApplicationState({ phase, serverEpoch: 'test', stateSequence: 0, capturedAt: 0 }).ok,
    ).toBe(true)
  })
  test('rejects fabricated idle resources', () => {
    expect(
      decodeApplicationState({
        phase: 'idle',
        serverEpoch: 'test',
        stateSequence: 0,
        capturedAt: 0,
        projects: [],
      }).ok,
    ).toBe(false)
  })
  test('rejects inherited phase without reading fields', () => {
    const input = Object.assign(Object.create({ phase: 'ready' }), applicationWithBlocker())
    Reflect.deleteProperty(input, 'phase')
    expect(decodeApplicationState(input).ok).toBe(false)
  })
  test('rejects nested accessors without invoking them', () => {
    let reads = 0
    const input = applicationWithBlocker()
    Object.defineProperty(canonical(input).ticket.resource.observation.value, 'typeEvidence', {
      enumerable: true,
      get() {
        reads++
        throw new Error('private-value')
      },
    })
    const result = decodeApplicationState(input)
    expect(result.ok).toBe(false)
    expect(reads).toBe(0)
    expect(JSON.stringify(result)).not.toContain('private-value')
  })
  test('refuses extra outgoing secrets before and after serialization', () => {
    const input = { ...applicationWithBlocker(), token: 'private-value' }
    for (const value of [input, JSON.parse(JSON.stringify(input))]) {
      const result = decodeApplicationState(value)
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain('private-value')
    }
  })
  test('authoritative type evidence guard refuses inherited kind', () => {
    expect(
      ticketTypeEvidenceSchema.safeParse(Object.create({ kind: 'missing', labels: [] })).success,
    ).toBe(false)
  })
  test('keeps real last-successful map content under proven absence', () => {
    const input = applicationWithBlocker()
    const { project, map } = canonical(input)
    const lastSuccessful = map.resource.observation
    Reflect.set(map, 'resource', {
      kind: 'proven-absent',
      absence: {
        scope: { kind: 'map', map: mapRef },
        attemptedAt: 2,
        observedAt: 2,
        provenance: { ...provenance, stage: 'map-list' },
        proof: {
          kind: 'complete-membership',
          parent: { kind: 'maps-membership', project: projectRef },
        },
      },
      trace: { kind: 'last-successful-trace', lastSuccessful },
    })
    project.mapsMembership.observation.value.members = []
    project.displayOrder.open = []
    Reflect.set(project, 'activeMap', { kind: 'known-empty' })
    const result = decodeApplicationState(input)
    expect(result.ok).toBe(true)
    if (result.ok && result.value.phase === 'ready') {
      const resource = result.value.projects[0]?.maps[0]?.resource
      if (resource?.kind !== 'proven-absent' || resource.trace.kind !== 'last-successful-trace')
        throw new Error('Expected actual historical trace')
      expect(resource.trace.lastSuccessful.value.body.raw).toBe('# Actual map prose')
      expect(resource.trace.lastSuccessful.observedAt).toBe(1)
      expect(resource.absence.observedAt).toBe(2)
    }
  })
  test('accepts never-observed without invented content', () => {
    const input = applicationWithBlocker()
    const { project } = canonical(input)
    Reflect.set(project, 'resource', {
      kind: 'never-observed',
      scope: { kind: 'project', project: projectRef },
      current: null,
    })
    Reflect.set(project, 'mapsMembership', { kind: 'never-observed', current: null })
    project.maps = []
    project.displayOrder.open = []
    project.activeMap = {
      kind: 'uncertain',
      reason: 'never-observed',
      cause: 'Active map has never been established.',
    }
    expect(decodeApplicationState(input).ok).toBe(true)
  })
  test('accepts known-empty without never-observed ambiguity', () => {
    const input = applicationWithBlocker()
    const { project } = canonical(input)
    project.maps = []
    project.mapsMembership.observation.value.members = []
    project.displayOrder.open = []
    Reflect.set(project, 'activeMap', { kind: 'known-empty' })
    expect(decodeApplicationState(input).ok).toBe(true)
  })
  test('preserves actual last success and distinct failed attempt in retained content', () => {
    const input = applicationWithBlocker()
    const { project, map } = canonical(input)
    const lastSuccessful = map.resource.observation
    Reflect.set(map, 'resource', {
      kind: 'retained-unavailable',
      lastSuccessful,
      unavailable: {
        kind: 'source-failure',
        scope: { kind: 'map', map: mapRef },
        attemptedAt: 2,
        provenance,
        failure: { kind: 'transient', cause: 'network' },
        cause: 'GitHub is temporarily unreachable.',
      },
    })
    project.activeMap = {
      kind: 'uncertain',
      reason: 'map-unavailable',
      cause: 'A map required for ordering is currently unavailable.',
    }
    const result = decodeApplicationState(input)
    expect(result.ok).toBe(true)
    if (result.ok && result.value.phase === 'ready') {
      const resource = result.value.projects[0]?.maps[0]?.resource
      if (
        resource?.kind !== 'retained-unavailable' ||
        resource.unavailable.kind !== 'source-failure'
      )
        throw new Error('Expected actual retained trace')
      expect(resource.lastSuccessful.value.body.raw).toBe('# Actual map prose')
      expect(resource.lastSuccessful.observedAt).toBe(1)
      expect(resource.unavailable.attemptedAt).toBe(2)
    }
  })
})

describe('own data operation replies', () => {
  const correlationId = correlationIdSchema.parse('1a82c8e3-70de-4165-a243-78dfce0d90a2')
  const query = querySchema.parse({ type: 'select-workspace' })
  const selection = {
    operation: 'select-workspace',
    subject: { kind: 'none' },
    serverEpoch: 'blocker-contract-server',
    stateSequence: 1,
    ok: true,
    result: { kind: 'selected', path: '/fixture' },
  }

  test('rejects result accessors without reading them', () => {
    let reads = 0
    expect(queryResultSchema.safeParse(selection).success).toBe(true)
    const result = Object.defineProperty({ ...selection }, 'ok', {
      enumerable: true,
      get() {
        reads++
        throw new Error('private-value')
      },
    })
    const decoded = decodeQueryResultEnvelope(
      { type: 'query-result', correlationId, result },
      query,
      correlationId,
    )
    expect(decoded.ok).toBe(false)
    expect(reads).toBe(0)
    expect(JSON.stringify(decoded)).not.toContain('private-value')
  })
  test('rejects inherited result discriminants', () => {
    expect(queryResultSchema.safeParse(selection).success).toBe(true)
    const own = { ...selection }
    Reflect.deleteProperty(own, 'ok')
    const result = Object.assign(Object.create({ ok: true }), own)
    expect(
      decodeQueryResultEnvelope(
        { type: 'query-result', correlationId, result },
        query,
        correlationId,
      ).ok,
    ).toBe(false)
  })
})
