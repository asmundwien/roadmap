import { projectActionSchema } from '@roadmap/contracts/state'
import { decodeApplicationState } from '@roadmap/contracts/wire'
import { describe, expect, test } from 'vitest'

const safeDestinations = [
  'https://github.com/owner/repo',
  'http://example.test:8080/repo?map=1#ticket',
  'https://[::1]:443/repo',
  'https://example.test/@owner?contact=user@example.test',
  '/',
  '/projects/github/opaque%2Fproject?map=1#ticket',
  '/repositories/42/issues/7',
]
const malformedDestinations = [
  'https://?',
  'http://#fragment',
  'https://:443/repo',
  'https://[invalid]/repo',
  'https://example.test:invalid/repo',
  'https://example.test:65536/repo',
]
const credentialDestinations = [
  'https://fixture-user:fixture-password@example.test/repo',
  'https://fixture-user@example.test/repo',
  'http://:fixture-password@example.test/repo',
  'https://fixture%2Duser:fixture%2Dpassword@example.test/repo',
]
const forbiddenDestinations = [
  '',
  'javascript:alert(1)',
  'data:text/html,unsafe',
  'file:///fixture/repo',
  'ftp://example.test/repo',
  '//other.example/repo',
  'projects/github/repo',
  'https://example.test/white space',
  'https://example.test/line\nbreak',
  'https://example.test/back\\slash',
  '/white space',
  '/back\\slash',
  '/\\other.example/repo',
]

function stateWithRepositoryDestination(url: string) {
  const ref = { integration: 'github', projectId: 'destination/project' }
  const source = { integration: 'github', repositoryId: '42', nameWithOwner: 'owner/repo', url }
  function metadata(stage: string) {
    return {
      attemptedAt: 1,
      observedAt: 1,
      provenance: { integration: 'github', connectionId: 'github', repositoryId: '42', stage },
      completeness: { kind: 'complete' },
    }
  }
  const project = {
    integration: 'github',
    ref,
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
        scope: { kind: 'project', project: ref },
        value: { name: 'owner/repo', source: structuredClone(source), warnings: [] },
      },
    },
    mapsMembership: {
      kind: 'current-complete',
      observation: {
        ...metadata('map-list'),
        scope: { kind: 'maps-membership', project: ref },
        value: { members: [] },
      },
    },
    maps: [],
    displayOrder: { open: [], closed: [] },
    activeMap: { kind: 'known-empty' },
  }
  return {
    phase: 'ready',
    mode: 'mutable',
    serverEpoch: 'destination-contract',
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

describe('public link action destinations', () => {
  const kind = 'external-link'
  test.each(safeDestinations)('preserves usable destination %s', (href) => {
    const action = { id: 'destination', label: 'Open', kind, href }
    expect(projectActionSchema.safeParse(action)).toMatchObject({ success: true, data: action })
  })
  test.each(malformedDestinations)('refuses malformed HTTP URL %s', (href) => {
    expect(
      projectActionSchema.safeParse({ id: 'destination', label: 'Open', kind, href }).success,
    ).toBe(false)
  })
  test.each(credentialDestinations)('refuses URL userinfo %s', (href) => {
    expect(
      projectActionSchema.safeParse({ id: 'destination', label: 'Open', kind, href }).success,
    ).toBe(false)
  })
  test.each(forbiddenDestinations)('preserves destination policy refusal %#', (href) => {
    expect(
      projectActionSchema.safeParse({ id: 'destination', label: 'Open', kind, href }).success,
    ).toBe(false)
  })
  test.each([
    'https://?',
    'https://fixture-private-user:fixture-private-password@example.test/repo',
  ])('does not echo rejected destinations in action diagnostics %#', (href) => {
    const result = projectActionSchema.safeParse({ id: 'destination', label: 'Open', kind, href })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).not.toContain(href)
    expect(JSON.stringify(result)).not.toContain('fixture-private-user')
    expect(JSON.stringify(result)).not.toContain('fixture-private-password')
  })
  test('preserves the roadmap action application path', () => {
    const action = {
      id: 'destination',
      label: 'Roadmap',
      kind: 'roadmap',
      href: '/projects/github/opaque%2Fproject',
    }
    expect(projectActionSchema.safeParse(action)).toMatchObject({ success: true, data: action })
  })
})

describe('actual repository destinations at the whole-state boundary', () => {
  test('preserves a matching current Project and observed repository destination', () => {
    const input = stateWithRepositoryDestination('/repositories/42')
    expect(decodeApplicationState(input)).toEqual({ ok: true, value: input })
  })
  test.each([
    'https://?',
    'https://fixture-private-user:fixture-private-password@example.test/repo',
  ])('refuses unusable or credential-bearing current source without echoing it %#', (url) => {
    const result = decodeApplicationState(stateWithRepositoryDestination(url))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected repository destination refusal.')
    expect(result.issues.some((issue) => issue.path.includes('source'))).toBe(true)
    expect(JSON.stringify(result)).not.toContain(url)
    expect(JSON.stringify(result)).not.toContain('fixture-private-user')
    expect(JSON.stringify(result)).not.toContain('fixture-private-password')
  })
})
