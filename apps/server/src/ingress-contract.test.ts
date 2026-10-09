import {
  configurationVersionSchema,
  projectRefSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import { type Command, commandSchema, type Query } from '@roadmap/contracts/operations'
import {
  decodeCommandEnvelope,
  decodeQueryEnvelope,
  decodeRequestRejection,
  type RequestRejection,
  requestIdSchema,
  requestRejectionStatus,
} from '@roadmap/contracts/wire'
import { describe, expect, expectTypeOf, it } from 'vitest'

const localProject = projectRefSchema.parse({ integration: 'local', projectId: 'local-project' })
const githubProject = projectRefSchema.parse({ integration: 'github', projectId: 'github-project' })
const version = { expectedConfigurationVersion: configurationVersionSchema.parse(0) }
const target = ticketRefSchema.parse({
  map: { project: githubProject, mapId: 'map-1' },
  ticketId: 'ticket-1',
})
const secret = 'private-ingress-credential-value'

function inherited(prototype: object, own: object = {}): unknown {
  return Object.assign(Object.create(prototype), own)
}

const supportedCommands = [
  { type: 'begin-github-authorization', ...version, name: 'GitHub' },
  {
    type: 'begin-github-authorization',
    ...version,
    name: 'GitHub',
    connectionId: 'github-connection',
  },
  { type: 'cancel-github-authorization', ...version, operationId: 'authorization-1' },
  { type: 'retry-github-authorization', ...version, operationId: 'authorization-1' },
  { type: 'rename-connection', ...version, connectionId: 'github-connection', name: 'Work' },
  { type: 'remove-connection', ...version, connectionId: 'github-connection' },
  {
    type: 'register-project',
    ...version,
    candidate: { integration: 'local', connectionId: 'local', workspace: { path: '/local' } },
  },
  {
    type: 'register-project',
    ...version,
    candidate: {
      integration: 'github',
      connectionId: 'github-connection',
      workspace: { path: '/github' },
      displayName: 'Roadmap',
    },
  },
  { type: 'rename-project', ...version, project: localProject, name: 'Local roadmap' },
  {
    type: 'repair-project-workspace',
    ...version,
    project: localProject,
    workspace: { path: '/repaired' },
  },
  {
    type: 'register-project',
    ...version,
    candidate: {
      integration: 'local',
      connectionId: 'local',
      workspace: { path: '/local' },
      displayName: 'Local roadmap',
    },
  },
  {
    type: 'register-project',
    ...version,
    candidate: {
      integration: 'github',
      connectionId: 'github-connection',
      workspace: { path: '/github' },
    },
  },
  {
    type: 'repair-project-workspace',
    ...version,
    project: githubProject,
    workspace: { path: '/repaired' },
  },
  { type: 'remove-project', ...version, project: githubProject },
  { type: 'set-automation-enabled', ...version, enabled: false },
  { type: 'set-project-automation-enabled', ...version, project: localProject, enabled: true },
  { type: 'start-automation-override', ...version, target, stage: 'classification' },
  { type: 'start-automation-override', ...version, target, stage: 'wayfinder' },
  { type: 'refresh-project', ...version, project: githubProject },
  { type: 'launch-action', ...version, actionId: 'open-settings' },
  { type: 'launch-action', ...version, actionId: 'open-workspace', project: localProject },
].map((command) => commandSchema.parse(command))

const malformedCommands: { name: string; command: unknown }[] = [
  { name: 'missing discriminator', command: { ...version, enabled: true } },
  { name: 'unsupported operation', command: { type: 'execute-shell', ...version } },
  { name: 'non-string discriminator', command: { type: 1, ...version } },
  { name: 'missing version', command: { type: 'set-automation-enabled', enabled: true } },
  {
    name: 'negative version',
    command: { type: 'set-automation-enabled', expectedConfigurationVersion: -1, enabled: true },
  },
  {
    name: 'fractional version',
    command: { type: 'set-automation-enabled', expectedConfigurationVersion: 0.5, enabled: true },
  },
  {
    name: 'unsafe integer version',
    command: {
      type: 'set-automation-enabled',
      expectedConfigurationVersion: Number.MAX_SAFE_INTEGER + 1,
      enabled: true,
    },
  },
  {
    name: 'non-finite version',
    command: {
      type: 'set-automation-enabled',
      expectedConfigurationVersion: Infinity,
      enabled: true,
    },
  },
  {
    name: 'string version',
    command: { type: 'set-automation-enabled', expectedConfigurationVersion: '0', enabled: true },
  },
  {
    name: 'missing authorization name',
    command: { type: 'begin-github-authorization', ...version },
  },
  {
    name: 'null optional connection',
    command: { type: 'begin-github-authorization', ...version, name: 'GitHub', connectionId: null },
  },
  {
    name: 'missing cancellation operation',
    command: { type: 'cancel-github-authorization', ...version },
  },
  {
    name: 'wrong retry operation',
    command: { type: 'retry-github-authorization', ...version, operationId: 1 },
  },
  {
    name: 'missing connection rename',
    command: { type: 'rename-connection', ...version, connectionId: 'connection-1' },
  },
  { name: 'missing removed connection', command: { type: 'remove-connection', ...version } },
  { name: 'missing candidate', command: { type: 'register-project', ...version } },
  {
    name: 'unsupported candidate integration',
    command: {
      type: 'register-project',
      ...version,
      candidate: {
        integration: 'remote',
        connectionId: 'connection-1',
        workspace: { path: '/workspace' },
      },
    },
  },
  {
    name: 'missing candidate connection',
    command: {
      type: 'register-project',
      ...version,
      candidate: { integration: 'local', workspace: { path: '/workspace' } },
    },
  },
  {
    name: 'missing candidate workspace path',
    command: {
      type: 'register-project',
      ...version,
      candidate: { integration: 'local', connectionId: 'local', workspace: {} },
    },
  },
  {
    name: 'wrong optional candidate name',
    command: {
      type: 'register-project',
      ...version,
      candidate: {
        integration: 'local',
        connectionId: 'local',
        workspace: { path: '/workspace' },
        displayName: false,
      },
    },
  },
  {
    name: 'missing renamed project',
    command: { type: 'rename-project', ...version, name: 'Roadmap' },
  },
  {
    name: 'missing repair workspace',
    command: { type: 'repair-project-workspace', ...version, project: localProject },
  },
  {
    name: 'private repair proof field',
    command: {
      type: 'repair-project-workspace',
      ...version,
      project: localProject,
      workspace: { path: '/workspace', gitIdentity: 'cannot-mint-proof' },
    },
  },
  { name: 'null project', command: { type: 'remove-project', ...version, project: null } },
  {
    name: 'missing project id',
    command: { type: 'remove-project', ...version, project: { integration: 'local' } },
  },
  {
    name: 'non-boolean enabled',
    command: { type: 'set-automation-enabled', ...version, enabled: 'false' },
  },
  {
    name: 'missing project enabled',
    command: { type: 'set-project-automation-enabled', ...version, project: localProject },
  },
  {
    name: 'missing override target',
    command: { type: 'start-automation-override', ...version, stage: 'classification' },
  },
  {
    name: 'missing override map',
    command: {
      type: 'start-automation-override',
      ...version,
      target: { project: localProject, ticketId: 'ticket-1' },
      stage: 'classification',
    },
  },
  {
    name: 'missing override ticket',
    command: {
      type: 'start-automation-override',
      ...version,
      target: { project: localProject, mapId: 'map-1' },
      stage: 'classification',
    },
  },
  {
    name: 'unsupported override stage',
    command: { type: 'start-automation-override', ...version, target, stage: 'execute' },
  },
  { name: 'missing refresh project', command: { type: 'refresh-project', ...version } },
  { name: 'missing action id', command: { type: 'launch-action', ...version } },
  {
    name: 'null optional action project',
    command: { type: 'launch-action', ...version, actionId: 'open-workspace', project: null },
  },
]

describe('ingress operation parsing', () => {
  it('decodes the supported query without changing its meaning', () => {
    expect(decodeQueryEnvelope({ type: 'query', query: { type: 'select-workspace' } })).toEqual({
      ok: true,
      value: { type: 'query', query: { type: 'select-workspace' } },
    })
  })

  it.each(supportedCommands)('preserves supported command $type %#', (command) => {
    expect(decodeCommandEnvelope({ type: 'command', command })).toEqual({
      ok: true,
      value: { type: 'command', command },
    })
  })

  it.each([null, [], true, 1, 'query', {}])('rejects non-envelope input %j', (input) => {
    expect(decodeQueryEnvelope(input).ok).toBe(false)
    expect(decodeCommandEnvelope(input).ok).toBe(false)
  })

  it.each([
    { type: 'command', query: { type: 'select-workspace' } },
    { type: 'query' },
    { type: 'query', query: null },
    { type: 'query', query: [] },
    { type: 'query', query: {} },
    { type: 'query', query: { type: 'refresh-project' } },
  ])('rejects malformed query envelope %j', (input) => {
    expect(decodeQueryEnvelope(input).ok).toBe(false)
  })

  it.each([
    { type: 'query', command: { type: 'set-automation-enabled', ...version, enabled: true } },
    { type: 'command' },
    { type: 'command', command: null },
    { type: 'command', command: [] },
  ])('rejects malformed command envelope %j', (input) => {
    expect(decodeCommandEnvelope(input).ok).toBe(false)
  })

  it.each(malformedCommands)('rejects $name', ({ command }) => {
    expect(decodeCommandEnvelope({ type: 'command', command }).ok).toBe(false)
  })

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects unsupported discriminator %s without throwing',
    (type) => {
      expect(decodeQueryEnvelope({ type: 'query', query: { type } }).ok).toBe(false)
      expect(decodeCommandEnvelope({ type: 'command', command: { type, ...version } }).ok).toBe(
        false,
      )
    },
  )

  it.each([
    {
      name: 'envelope type',
      input: inherited({ type: 'query' }, { query: { type: 'select-workspace' } }),
    },
    {
      name: 'envelope query',
      input: inherited({ query: { type: 'select-workspace' } }, { type: 'query' }),
    },
    {
      name: 'query discriminator',
      input: { type: 'query', query: inherited({ type: 'select-workspace' }) },
    },
  ])('rejects inherited $name', ({ input }) => {
    expect(decodeQueryEnvelope(input).ok).toBe(false)
  })

  it.each([
    {
      name: 'envelope type',
      input: inherited(
        { type: 'command' },
        { command: { type: 'set-automation-enabled', ...version, enabled: true } },
      ),
    },
    {
      name: 'envelope command',
      input: inherited(
        { command: { type: 'set-automation-enabled', ...version, enabled: true } },
        { type: 'command' },
      ),
    },
    {
      name: 'command discriminator',
      input: {
        type: 'command',
        command: inherited({ type: 'set-automation-enabled' }, { ...version, enabled: true }),
      },
    },
    {
      name: 'configuration version',
      input: {
        type: 'command',
        command: inherited(version, { type: 'set-automation-enabled', enabled: true }),
      },
    },
    {
      name: 'enabled field',
      input: {
        type: 'command',
        command: inherited({ enabled: true }, { type: 'set-automation-enabled', ...version }),
      },
    },
    {
      name: 'project integration',
      input: {
        type: 'command',
        command: {
          type: 'remove-project',
          ...version,
          project: inherited({ integration: 'local' }, { id: 'local-project' }),
        },
      },
    },
    {
      name: 'project id',
      input: {
        type: 'command',
        command: {
          type: 'remove-project',
          ...version,
          project: inherited({ id: 'local-project' }, { integration: 'local' }),
        },
      },
    },
    {
      name: 'candidate integration',
      input: {
        type: 'command',
        command: {
          type: 'register-project',
          ...version,
          candidate: inherited(
            { integration: 'local' },
            { connectionId: 'local', workspace: { path: '/workspace' } },
          ),
        },
      },
    },
    {
      name: 'candidate workspace',
      input: {
        type: 'command',
        command: {
          type: 'register-project',
          ...version,
          candidate: inherited(
            { workspace: { path: '/workspace' } },
            { integration: 'local', connectionId: 'local' },
          ),
        },
      },
    },
    {
      name: 'candidate workspace path',
      input: {
        type: 'command',
        command: {
          type: 'register-project',
          ...version,
          candidate: {
            integration: 'local',
            connectionId: 'local',
            workspace: inherited({ path: '/workspace' }),
          },
        },
      },
    },
    {
      name: 'repair workspace path',
      input: {
        type: 'command',
        command: {
          type: 'repair-project-workspace',
          ...version,
          project: localProject,
          workspace: inherited({ path: '/workspace' }),
        },
      },
    },
    {
      name: 'override ticket',
      input: {
        type: 'command',
        command: {
          type: 'start-automation-override',
          ...version,
          stage: 'classification',
          target: inherited({ ticketId: 'ticket-1' }, { project: localProject, mapId: 'map-1' }),
        },
      },
    },
  ])('rejects inherited $name', ({ input }) => {
    expect(decodeCommandEnvelope(input).ok).toBe(false)
  })

  it.each([
    { type: 'query', query: { type: 'select-workspace' }, token: secret },
    { type: 'query', query: { type: 'select-workspace', token: secret } },
    { type: 'query', query: { type: secret } },
  ])('refuses query secrets without including their values in diagnostics %#', (input) => {
    const result = decodeQueryEnvelope(input)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it.each([
    {
      type: 'command',
      command: { type: 'launch-action', ...version, actionId: 'open-settings' },
      token: secret,
    },
    {
      type: 'command',
      command: { type: 'launch-action', ...version, actionId: 'open-settings', executable: secret },
    },
    {
      type: 'command',
      command: { type: 'remove-project', ...version, project: { ...localProject, token: secret } },
    },
    {
      type: 'command',
      command: {
        type: 'register-project',
        ...version,
        candidate: {
          integration: 'local',
          connectionId: 'local',
          workspace: { path: '/workspace' },
          token: secret,
        },
      },
    },
    {
      type: 'command',
      command: {
        type: 'register-project',
        ...version,
        candidate: {
          integration: 'github',
          connectionId: 'github-connection',
          workspace: { path: '/workspace', gitIdentity: secret },
        },
      },
    },
    {
      type: 'command',
      command: {
        type: 'repair-project-workspace',
        ...version,
        project: localProject,
        workspace: { path: '/workspace', token: secret },
      },
    },
    {
      type: 'command',
      command: {
        type: 'start-automation-override',
        ...version,
        target: { ...target, token: secret },
        stage: 'classification',
      },
    },
    { type: 'command', command: { type: secret, ...version } },
    {
      type: 'command',
      command: {
        type: 'set-automation-enabled',
        expectedConfigurationVersion: secret,
        enabled: true,
      },
    },
  ])('refuses command secrets without including their values in diagnostics %#', (input) => {
    const result = decodeCommandEnvelope(input)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})

describe('operation construction proofs', () => {
  it('does not admit unsupported or incomplete queries', () => {
    expectTypeOf<{ type: 'refresh-project' }>().not.toExtend<Query>()
    expectTypeOf<Record<string, never>>().not.toExtend<Query>()
  })

  it('requires the version and the payload of each command variant', () => {
    expectTypeOf<{
      type: 'set-automation-enabled'
      enabled: boolean
    }>().not.toExtend<Command>()
    expectTypeOf<{
      type: 'set-automation-enabled'
      expectedConfigurationVersion: string
      enabled: boolean
    }>().not.toExtend<Command>()
    expectTypeOf<{
      type: 'set-automation-enabled'
      expectedConfigurationVersion: number
      enabled: string
    }>().not.toExtend<Command>()
    expectTypeOf<{
      type: 'begin-github-authorization'
      expectedConfigurationVersion: number
    }>().not.toExtend<Command>()
    expectTypeOf<{
      type: 'register-project'
      expectedConfigurationVersion: number
      candidate: { integration: 'local'; connectionId: string }
    }>().not.toExtend<Command>()
    expectTypeOf<{
      type: 'remove-project'
      expectedConfigurationVersion: number
      project: { integration: 'remote'; id: string }
    }>().not.toExtend<Command>()
    expectTypeOf<{
      type: 'start-automation-override'
      expectedConfigurationVersion: number
      target: { project: typeof localProject; mapId: string; ticketId: string }
      stage: 'execute'
    }>().not.toExtend<Command>()
    expectTypeOf<{
      type: 'launch-action'
      expectedConfigurationVersion: number
    }>().not.toExtend<Command>()
    expectTypeOf<{
      type: 'execute-shell'
      expectedConfigurationVersion: number
      executable: string
    }>().not.toExtend<Command>()
  })
})

const rejection = {
  type: 'request-rejected',
  request: 'command',
  requestId: '9199da9c-5a10-4e44-9e44-25e5344564c2',
  reason: 'malformed-envelope',
  message: 'The request envelope is invalid.',
} satisfies RequestRejection

describe('request rejection parsing', () => {
  it.each(['query', 'command'] as const)('preserves a strict %s rejection', (request) => {
    const input = { ...rejection, request }
    expect(decodeRequestRejection(input)).toEqual({ ok: true, value: input })
    expect(decodeRequestRejection({ ...input, requestId: null })).toEqual({
      ok: true,
      value: { ...input, requestId: null },
    })
  })

  it.each([
    null,
    [],
    {},
    { ...rejection, type: 'command-result' },
    { ...rejection, request: 'state' },
    { ...rejection, reason: 'dependency' },
    { ...rejection, requestId: '' },
    { ...rejection, requestId: 'not-a-uuid' },
    { ...rejection, requestId: 1 },
    { ...rejection, message: null },
    { ...rejection, state: {} },
    { ...rejection, outcome: { ok: false } },
    {
      type: rejection.type,
      request: rejection.request,
      reason: rejection.reason,
      message: rejection.message,
    },
    {
      type: rejection.type,
      request: rejection.request,
      requestId: null,
      message: rejection.message,
    },
    { type: rejection.type, request: rejection.request, requestId: null, reason: rejection.reason },
  ])('rejects malformed rejection %#', (input) => {
    expect(decodeRequestRejection(input).ok).toBe(false)
  })

  it.each(['type', 'request', 'requestId', 'reason', 'message'] as const)(
    'rejects inherited rejection %s',
    (field) => {
      const own = { ...rejection }
      Reflect.deleteProperty(own, field)
      expect(decodeRequestRejection(inherited({ [field]: rejection[field] }, own)).ok).toBe(false)
    },
  )

  it.each([
    { ...rejection, token: secret },
    { ...rejection, [secret]: 'unknown-field' },
    { ...rejection, reason: secret },
    { ...rejection, request: secret },
    { ...rejection, requestId: secret },
    { ...rejection, message: { token: secret } },
  ])('refuses malformed rejection secrets without diagnostic disclosure %#', (input) => {
    const decoded = decodeRequestRejection(input)
    expect(decoded.ok).toBe(false)
    expect(JSON.stringify(decoded)).not.toContain(secret)
  })

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects unsupported rejection enum %s without throwing',
    (value) => {
      expect(decodeRequestRejection({ ...rejection, reason: value }).ok).toBe(false)
      expect(decodeRequestRejection({ ...rejection, request: value }).ok).toBe(false)
    },
  )

  it.each([
    { reason: 'origin', status: 403 },
    { reason: 'peer', status: 403 },
    { reason: 'method', status: 405 },
    { reason: 'media-type', status: 415 },
    { reason: 'too-large', status: 413 },
    { reason: 'malformed-json', status: 400 },
    { reason: 'malformed-envelope', status: 400 },
    { reason: 'interrupted', status: 400 },
  ] satisfies { reason: RequestRejection['reason']; status: number }[])(
    'maps $reason to its admission HTTP status',
    ({ reason, status }) => expect(requestRejectionStatus(reason)).toBe(status),
  )

  it('validates call-local UUIDs without accepting arbitrary strings', () => {
    expect(requestIdSchema.safeParse(rejection.requestId).success).toBe(true)
    expect(requestIdSchema.safeParse(null).success).toBe(false)
    expect(requestIdSchema.safeParse('not-a-uuid').success).toBe(false)
    expect(requestIdSchema.safeParse(rejection.requestId + secret).success).toBe(false)
  })
})

describe('schema-derived construction proofs', () => {
  it('keeps unknown decoder input and the authoritative output types', () => {
    expectTypeOf(decodeCommandEnvelope).parameter(0).toEqualTypeOf<unknown>()
    expectTypeOf(decodeQueryEnvelope).parameter(0).toEqualTypeOf<unknown>()
    expectTypeOf(decodeRequestRejection).parameter(0).toEqualTypeOf<unknown>()
    type ParsedCommand = Extract<
      ReturnType<typeof decodeCommandEnvelope>,
      { ok: true }
    >['value']['command']
    type ParsedQuery = Extract<
      ReturnType<typeof decodeQueryEnvelope>,
      { ok: true }
    >['value']['query']
    expectTypeOf<ParsedCommand>().toEqualTypeOf<Command>()
    expectTypeOf<ParsedQuery>().toEqualTypeOf<Query>()
  })

  it('rejects malformed typed construction at compile time and runtime', () => {
    // @ts-expect-error Unsupported operations cannot construct a Query.
    const badQuery: Query = { type: 'refresh-project' }
    // @ts-expect-error The command version is required.
    const badCommand: Command = { type: 'set-automation-enabled', enabled: true }
    // @ts-expect-error Admission rejections require correlation, even when it is null.
    const badRejection: RequestRejection = {
      type: 'request-rejected',
      request: 'command',
      reason: 'origin',
      message: 'The origin is not allowed.',
    }
    expect(decodeQueryEnvelope({ type: 'query', query: badQuery }).ok).toBe(false)
    expect(decodeCommandEnvelope({ type: 'command', command: badCommand }).ok).toBe(false)
    expect(decodeRequestRejection(badRejection).ok).toBe(false)
  })
})

describe('own data request boundaries', () => {
  it('rejects accessors without reading or disclosing them', () => {
    let reads = 0
    const query = Object.defineProperty({}, 'type', {
      enumerable: true,
      get() {
        reads += 1
        throw new Error(secret)
      },
    })
    const result = decodeQueryEnvelope({ type: 'query', query })
    expect(result.ok).toBe(false)
    expect(reads).toBe(0)
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it.each([
    {
      name: 'envelope',
      data: { type: 'query', query: { type: 'select-workspace' } },
      field: 'query',
      decode: decodeQueryEnvelope,
      envelope: (data: object) => data,
    },
    {
      name: 'command',
      data: { type: 'set-automation-enabled', ...version, enabled: true },
      field: 'enabled',
      decode: decodeCommandEnvelope,
      envelope: (data: object) => ({ type: 'command', command: data }),
    },
    {
      name: 'project',
      data: { ...localProject },
      field: 'projectId',
      decode: decodeCommandEnvelope,
      envelope: (data: object) => ({
        type: 'command',
        command: { type: 'remove-project', ...version, project: data },
      }),
    },
    {
      name: 'candidate',
      data: { integration: 'local', connectionId: 'local', workspace: { path: '/workspace' } },
      field: 'connectionId',
      decode: decodeCommandEnvelope,
      envelope: (data: object) => ({
        type: 'command',
        command: { type: 'register-project', ...version, candidate: data },
      }),
    },
    {
      name: 'candidate workspace',
      data: { path: '/workspace' },
      field: 'path',
      decode: decodeCommandEnvelope,
      envelope: (data: object) => ({
        type: 'command',
        command: {
          type: 'register-project',
          ...version,
          candidate: { integration: 'local', connectionId: 'local', workspace: data },
        },
      }),
    },
    {
      name: 'repair workspace',
      data: { path: '/workspace' },
      field: 'path',
      decode: decodeCommandEnvelope,
      envelope: (data: object) => ({
        type: 'command',
        command: {
          type: 'repair-project-workspace',
          ...version,
          project: localProject,
          workspace: data,
        },
      }),
    },
    {
      name: 'automation target',
      data: { ...target },
      field: 'ticketId',
      decode: decodeCommandEnvelope,
      envelope: (data: object) => ({
        type: 'command',
        command: {
          type: 'start-automation-override',
          ...version,
          stage: 'classification',
          target: data,
        },
      }),
    },
    {
      name: 'rejection',
      data: { ...rejection },
      field: 'reason',
      decode: decodeRequestRejection,
      envelope: (data: object) => data,
    },
  ])(
    'rejects an accessor at the $name boundary without reading it',
    ({ data, field, decode, envelope }) => {
      let reads = 0
      Object.defineProperty(data, field, {
        enumerable: true,
        get() {
          reads += 1
          return secret
        },
      })
      const result = decode(envelope(data))
      expect(result.ok).toBe(false)
      expect(reads).toBe(0)
      expect(JSON.stringify(result)).not.toContain(secret)
    },
  )
})
