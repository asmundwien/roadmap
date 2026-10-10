import {
  authorizationOperationIdSchema,
  configurationVersionSchema,
  connectionIdSchema,
  correlationIdSchema,
  projectRefSchema,
  serverEpochSchema,
  stateSequenceSchema,
  ticketRefSchema,
} from '@roadmap/contracts/identity'
import {
  type Command,
  type CommandResultFor,
  commandOutcomeSchema,
  commandResultSchema,
  commandSchema,
  commandSubject,
  queryResultSchema,
  querySchema,
  refreshAttemptSchema,
  safeErrorSchema,
} from '@roadmap/contracts/operations'
import {
  applicationStateSchema,
  githubConnectionSchema,
  projectActionSchema,
} from '@roadmap/contracts/state'
import {
  decodeCommandEnvelope,
  decodeCommandResultEnvelope,
  decodeQueryEnvelope,
  decodeQueryResultEnvelope,
} from '@roadmap/contracts/wire'
import { describe, expect, test } from 'vitest'

const correlationId = correlationIdSchema.parse('0bb7f422-5171-4e12-a6de-d54b63f989be')
const otherCorrelationId = correlationIdSchema.parse('503ca203-64fb-4410-811c-1570d0d779c7')
const provenance = {
  serverEpoch: serverEpochSchema.parse('operation-contract-producer'),
  stateSequence: stateSequenceSchema.parse(7),
}
const version = { expectedConfigurationVersion: configurationVersionSchema.parse(2) }
const committedVersion = configurationVersionSchema.parse(3)
const projectRef = projectRefSchema.parse({ integration: 'local', projectId: 'canonical-project' })
const connectionId = connectionIdSchema.parse('github-connection')
const operationId = authorizationOperationIdSchema.parse('authorization-operation')
const query = querySchema.parse({ type: 'select-workspace' })
const secret = 'operation-contract-private-credential'
const selectionError = safeErrorSchema.parse({
  code: 'selection-failed',
  message: 'Selector failed.',
})

const project = projectRef
const connection = githubConnectionSchema.parse({
  id: connectionId,
  integration: 'github',
  builtIn: false,
  name: 'Canonical connection',
  githubIdentity: { id: '42', login: 'fixture-account' },
  availability: { status: 'available' },
})
const retainedState = applicationStateSchema.parse({
  phase: 'starting',
  capturedAt: 1,
  ...provenance,
})
const launchCommand = {
  type: 'launch-project-operation',
  ...version,
  project: projectRef,
  operation: 'open-workspace',
}
const launchResult = {
  type: 'launch-project-operation',
  project,
  operation: 'open-workspace',
  status: 'invoked',
}
const launchOutcome = {
  operation: 'launch-project-operation',
  subject: { kind: 'project', project: projectRef },
  ...provenance,
  ok: true,
  result: launchResult,
}
const launchEnvelope = { type: 'command-result', correlationId, outcome: launchOutcome }

function expectedLaunchCommand() {
  expect(commandSchema.safeParse(launchCommand).success).toBe(true)
  return commandSchema.parse(launchCommand)
}

function folderEnvelope(result: unknown) {
  return { type: 'query-result', correlationId, result }
}

function folderSuccess(result: unknown) {
  return {
    operation: 'select-workspace',
    subject: { kind: 'none' },
    ...provenance,
    ok: true,
    result,
  }
}

function authorizationResult(type: string, phase: object) {
  return { type, operationId, ...phase }
}

const waiting = {
  phase: 'waiting',
  verificationUri: 'https://github.com/login/device',
  userCode: 'FIXTURE-CODE',
  expiresAt: 120_000,
}
const granted = {
  phase: 'granted',
  connection: { connectionId: connection.id, accountId: connection.githubIdentity.id },
  configurationVersion: committedVersion,
}

const commit = { configurationVersion: committedVersion, commit: 'committed' } as const
const target = ticketRefSchema.parse({
  map: { project: projectRef, mapId: 'map' },
  ticketId: 'ticket',
})
const operationControls = {
  'begin-github-authorization': {
    command: { type: 'begin-github-authorization', ...version, name: 'GitHub' },
    result: { type: 'begin-github-authorization', operationId, ...waiting, phase: 'waiting' },
  },
  'reauthorize-github-connection': {
    command: { type: 'reauthorize-github-connection', ...version, connectionId },
    result: { type: 'reauthorize-github-connection', operationId, ...granted, phase: 'granted' },
  },
  'retry-github-authorization': {
    command: { type: 'retry-github-authorization', ...version, operationId },
    result: { type: 'retry-github-authorization', operationId, phase: 'expired' },
  },
  'cancel-github-authorization': {
    command: { type: 'cancel-github-authorization', ...version, operationId },
    result: { type: 'cancel-github-authorization', operationId, phase: 'cancelled' },
  },
  'rename-connection': {
    command: { type: 'rename-connection', ...version, connectionId, name: 'Renamed' },
    result: { type: 'rename-connection', connectionId, ...commit },
  },
  'remove-connection': {
    command: { type: 'remove-connection', ...version, connectionId },
    result: { type: 'remove-connection', connectionId, ...commit },
  },
  'register-project': {
    command: {
      type: 'register-project',
      ...version,
      candidate: { integration: 'local', connectionId, workspace: { path: '/unclean' } },
    },
    result: {
      type: 'register-project',
      project: projectRef,
      connectionId,
      workspacePath: '/canonical',
      ...commit,
    },
  },
  'rename-project': {
    command: { type: 'rename-project', ...version, project: projectRef, name: 'Renamed' },
    result: { type: 'rename-project', project: projectRef, ...commit },
  },
  'repair-project-workspace': {
    command: {
      type: 'repair-project-workspace',
      ...version,
      project: projectRef,
      workspace: { path: '/unclean' },
    },
    result: {
      type: 'repair-project-workspace',
      project: projectRef,
      workspacePath: '/canonical',
      ...commit,
    },
  },
  'remove-project': {
    command: { type: 'remove-project', ...version, project: projectRef },
    result: { type: 'remove-project', project: projectRef, ...commit },
  },
  'set-automation-enabled': {
    command: { type: 'set-automation-enabled', ...version, enabled: false },
    result: { type: 'set-automation-enabled', enabled: false, ...commit },
  },
  'set-project-automation-enabled': {
    command: {
      type: 'set-project-automation-enabled',
      ...version,
      project: projectRef,
      enabled: false,
    },
    result: {
      type: 'set-project-automation-enabled',
      project: projectRef,
      enabled: false,
      ...commit,
    },
  },
  'start-automation-override': {
    command: { type: 'start-automation-override', ...version, target, stage: 'classification' },
    result: {
      type: 'start-automation-override',
      target,
      stage: 'classification',
      admission: 'override',
      status: 'admitted',
    },
  },
  'refresh-project': {
    command: { type: 'refresh-project', ...version, project: projectRef },
    result: {
      type: 'refresh-project',
      project: projectRef,
      attempt: {
        kind: 'observed',
        attemptedAt: 800,
        observedAt: 900,
        provenance: { integration: 'local', path: '/canonical', operation: 'inspect-root' },
      },
    },
  },
  'launch-project-operation': {
    command: {
      type: 'launch-project-operation',
      ...version,
      project: projectRef,
      operation: 'open-workspace',
    },
    result: {
      type: 'launch-project-operation',
      project: projectRef,
      operation: 'open-workspace',
      status: 'invoked',
    },
  },
} satisfies {
  [T in Command['type']]: {
    command: Extract<Command, { type: T }>
    result: CommandResultFor<Extract<Command, { type: T }>>
  }
}

describe('every operation has an exact correlated result family', () => {
  test.each(Object.values(operationControls))(
    'accepts $command.type and refuses another independently valid family',
    ({ command, result }) => {
      const outcome = {
        operation: command.type,
        subject: commandSubject(command),
        ...provenance,
        ok: true,
        result,
      }
      const envelope = { type: 'command-result', correlationId, outcome }
      expect(commandSchema.safeParse(command).success).toBe(true)
      expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
      expect(decodeCommandResultEnvelope(envelope, command, correlationId)).toEqual({
        ok: true,
        value: envelope,
      })
      expect(decodeCommandResultEnvelope(envelope, command, otherCorrelationId).ok).toBe(false)
      const other =
        command.type === 'launch-project-operation'
          ? operationControls['rename-project']
          : operationControls['launch-project-operation']
      const wrong = {
        operation: other.command.type,
        subject: commandSubject(other.command),
        ...provenance,
        ok: true,
        result: other.result,
      }
      expect(commandOutcomeSchema.safeParse(wrong).success).toBe(true)
      expect(
        decodeCommandResultEnvelope({ ...envelope, outcome: wrong }, command, correlationId).ok,
      ).toBe(false)
    },
  )

  test.each(Object.values(operationControls))(
    'correlates $command.type application rejection separately from success',
    ({ command }) => {
      const outcome = {
        operation: command.type,
        subject: commandSubject(command),
        ...provenance,
        ok: false,
        error: selectionError,
      }
      const envelope = { type: 'command-result', correlationId, outcome }
      expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
      expect(decodeCommandResultEnvelope(envelope, command, correlationId)).toEqual({
        ok: true,
        value: envelope,
      })
      expect(decodeCommandResultEnvelope(envelope, command, otherCorrelationId).ok).toBe(false)
    },
  )

  test.each(
    Object.values(operationControls).filter(
      ({ command }) => !['none', 'automation'].includes(commandSubject(command).kind),
    ),
  )(
    'refuses another canonical subject for $command.type in success and rejection',
    ({ command, result }) => {
      const subject = commandSubject(command)
      let wrongSubject: unknown
      let wrongResult: unknown
      switch (subject.kind) {
        case 'connection': {
          const other = connectionIdSchema.parse('other-connection')
          wrongSubject = { ...subject, connectionId: other }
          wrongResult =
            result.type === 'reauthorize-github-connection' && result.phase === 'granted'
              ? { ...result, connection: { ...result.connection, connectionId: other } }
              : { ...result, connectionId: other }
          break
        }
        case 'authorization': {
          const other = authorizationOperationIdSchema.parse('other-authorization')
          wrongSubject = { ...subject, operationId: other }
          wrongResult = { ...result, operationId: other }
          break
        }
        case 'registration': {
          const other = connectionIdSchema.parse('other-connection')
          wrongSubject = { ...subject, connectionId: other }
          wrongResult = { ...result, connectionId: other }
          break
        }
        case 'project': {
          const other = projectRefSchema.parse({ ...subject.project, projectId: 'other-project' })
          wrongSubject = { ...subject, project: other }
          wrongResult = { ...result, project: other }
          break
        }
        case 'ticket': {
          const other = ticketRefSchema.parse({ ...subject.target, ticketId: 'other-ticket' })
          wrongSubject = { ...subject, target: other }
          wrongResult = { ...result, target: other }
          break
        }
        case 'none':
        case 'automation':
          throw new Error('Expected a scoped operation control')
      }
      for (const outcome of [
        {
          operation: command.type,
          subject: wrongSubject,
          ...provenance,
          ok: true,
          result: wrongResult,
        },
        {
          operation: command.type,
          subject: wrongSubject,
          ...provenance,
          ok: false,
          error: selectionError,
        },
      ]) {
        expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
        expect(
          decodeCommandResultEnvelope(
            { type: 'command-result', correlationId, outcome },
            command,
            correlationId,
          ).ok,
        ).toBe(false)
      }
      expect(
        commandOutcomeSchema.safeParse({
          operation: command.type,
          subject,
          ...provenance,
          ok: true,
          result: wrongResult,
        }).success,
      ).toBe(false)
    },
  )

  test.each(['project', 'map', 'stage'])(
    'refuses an otherwise valid Automation override for another %s',
    (scope) => {
      const { command, result } = operationControls['start-automation-override']
      const otherTarget = ticketRefSchema.parse(
        scope === 'project'
          ? { ...target, map: { ...target.map, project: { ...projectRef, integration: 'github' } } }
          : scope === 'map'
            ? { ...target, map: { ...target.map, mapId: 'other-map' } }
            : target,
      )
      const stage = scope === 'stage' ? 'wayfinder' : command.stage
      const outcome = {
        operation: command.type,
        subject: { kind: 'ticket', target: otherTarget, stage },
        ...provenance,
        ok: true,
        result: { ...result, target: otherTarget, stage },
      }
      expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
      expect(
        decodeCommandResultEnvelope(
          { type: 'command-result', correlationId, outcome },
          command,
          correlationId,
        ).ok,
      ).toBe(false)
    },
  )

  test('refuses registration for another otherwise valid integration', () => {
    const { command, result } = operationControls['register-project']
    const outcome = {
      operation: command.type,
      subject: { kind: 'registration', integration: 'github', connectionId },
      ...provenance,
      ok: true,
      result: { ...result, project: { ...projectRef, integration: 'github' } },
    }
    expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
    expect(
      decodeCommandResultEnvelope(
        { type: 'command-result', correlationId, outcome },
        command,
        correlationId,
      ).ok,
    ).toBe(false)
  })

  test.each([
    operationControls['set-automation-enabled'],
    operationControls['set-project-automation-enabled'],
  ])('refuses $command.type with a different otherwise valid preference', ({ command, result }) => {
    const outcome = {
      operation: command.type,
      subject: commandSubject(command),
      ...provenance,
      ok: true,
      result: { ...result, enabled: true },
    }
    expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
    expect(
      decodeCommandResultEnvelope(
        { type: 'command-result', correlationId, outcome },
        command,
        correlationId,
      ).ok,
    ).toBe(false)
  })

  test.each([
    operationControls['rename-connection'],
    operationControls['remove-connection'],
    operationControls['register-project'],
    operationControls['rename-project'],
    operationControls['repair-project-workspace'],
    operationControls['remove-project'],
    operationControls['set-automation-enabled'],
    operationControls['set-project-automation-enabled'],
  ])(
    'preserves canonical $command.type commit truth without submitted-path inference',
    ({ command, result }) => {
      for (const commit of ['committed', 'committed-unconfirmed']) {
        const outcome = {
          operation: command.type,
          subject: commandSubject(command),
          ...provenance,
          ok: true,
          result: { ...result, commit },
        }
        const envelope = { type: 'command-result', correlationId, outcome }
        expect(decodeCommandResultEnvelope(envelope, command, correlationId)).toEqual({
          ok: true,
          value: envelope,
        })
        for (const field of ['configurationVersion', 'commit']) {
          const malformed = { ...outcome.result }
          Reflect.deleteProperty(malformed, field)
          expect(commandResultSchema.safeParse(malformed).success).toBe(false)
        }
      }
    },
  )

  test.each(Object.values(operationControls))(
    'refuses a $command.type rejection that fabricates a result',
    ({ command, result }) => {
      const outcome = {
        operation: command.type,
        subject: commandSubject(command),
        ...provenance,
        ok: false,
        error: selectionError,
      }
      expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
      expect(commandOutcomeSchema.safeParse({ ...outcome, result }).success).toBe(false)
    },
  )
})

describe('state-free final operation wire outcomes', () => {
  test('accepts the canonical host invocation without claiming a durable Session', () => {
    const command = expectedLaunchCommand()
    expect(commandOutcomeSchema.safeParse(launchOutcome)).toMatchObject({
      success: true,
      data: launchOutcome,
    })
    expect(decodeCommandResultEnvelope(launchEnvelope, command, correlationId)).toEqual({
      ok: true,
      value: launchEnvelope,
    })
  })

  test('refuses read state attached to an otherwise valid acknowledgement', () => {
    expect(commandOutcomeSchema.safeParse(launchOutcome).success).toBe(true)
    expect(commandOutcomeSchema.safeParse({ ...launchOutcome, state: retainedState }).success).toBe(
      false,
    )
    expect(
      decodeCommandResultEnvelope(
        {
          ...launchEnvelope,
          outcome: { ...launchOutcome, state: retainedState },
        },
        expectedLaunchCommand(),
        correlationId,
      ).ok,
    ).toBe(false)
  })

  test.each(['serverEpoch', 'stateSequence', 'operation', 'subject'])(
    'requires outcome authority %s',
    (field) => {
      expect(commandOutcomeSchema.safeParse(launchOutcome).success).toBe(true)
      const malformed = { ...launchOutcome }
      Reflect.deleteProperty(malformed, field)
      expect(commandOutcomeSchema.safeParse(malformed).success).toBe(false)
    },
  )

  test('does not accept an independently valid result for another call correlation', () => {
    const command = expectedLaunchCommand()
    expect(decodeCommandResultEnvelope(launchEnvelope, command, correlationId).ok).toBe(true)
    expect(decodeCommandResultEnvelope(launchEnvelope, command, otherCorrelationId).ok).toBe(false)
  })

  test('does not let another valid command result family acknowledge a rename', () => {
    const command = commandSchema.parse({
      type: 'rename-project',
      ...version,
      project: projectRef,
      name: 'Renamed',
    })
    expect(commandResultSchema.safeParse(launchResult).success).toBe(true)
    expect(commandOutcomeSchema.safeParse(launchOutcome).success).toBe(true)
    expect(decodeCommandResultEnvelope(launchEnvelope, command, correlationId).ok).toBe(false)
  })

  test('refuses an acknowledgement whose result discriminant differs from its operation', () => {
    const result = authorizationResult('cancel-github-authorization', { phase: 'cancelled' })
    expect(commandResultSchema.safeParse(result).success).toBe(true)
    expect(commandOutcomeSchema.safeParse({ ...launchOutcome, result }).success).toBe(false)
  })

  test.each([
    { name: 'different Project ID', ref: { integration: 'local', projectId: 'another-project' } },
    {
      name: 'same opaque ID in another integration',
      ref: { integration: 'github', projectId: 'canonical-project' },
    },
  ])('refuses a valid launch result for $name', ({ ref }) => {
    const command = expectedLaunchCommand()
    const wrongProject = projectRefSchema.parse(ref)
    const outcome = {
      ...launchOutcome,
      subject: { kind: 'project', project: wrongProject },
      result: { ...launchResult, project: wrongProject },
    }
    expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
    expect(
      decodeCommandResultEnvelope({ ...launchEnvelope, outcome }, command, correlationId).ok,
    ).toBe(false)
  })

  test('does not treat another finite host operation as the requested invocation', () => {
    const command = expectedLaunchCommand()
    const outcome = { ...launchOutcome, result: { ...launchResult, operation: 'open-terminal' } }
    expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
    expect(
      decodeCommandResultEnvelope({ ...launchEnvelope, outcome }, command, correlationId).ok,
    ).toBe(false)
  })

  test('correlates application rejections rather than accepting any safe failure', () => {
    const command = expectedLaunchCommand()
    const outcome = {
      operation: 'launch-project-operation',
      subject: { kind: 'project', project: projectRef },
      ...provenance,
      ok: false,
      error: safeErrorSchema.parse({ code: 'launch-failed', message: 'Invocation failed.' }),
    }
    const envelope = { ...launchEnvelope, outcome }
    expect(decodeCommandResultEnvelope(envelope, command, correlationId).ok).toBe(true)
    expect(decodeCommandResultEnvelope(envelope, command, otherCorrelationId).ok).toBe(false)
    expect(
      decodeCommandResultEnvelope(
        { ...envelope, outcome: { ...outcome, operation: 'remove-project' } },
        command,
        correlationId,
      ).ok,
    ).toBe(false)
  })

  test.each([
    { integration: 'local', projectId: 'another-project' },
    { integration: 'github', projectId: 'canonical-project' },
  ])('rejects a safe application failure scoped to another Project %#', (ref) => {
    const command = expectedLaunchCommand()
    const outcome = {
      operation: 'launch-project-operation',
      subject: { kind: 'project', project: projectRefSchema.parse(ref) },
      ...provenance,
      ok: false,
      error: safeErrorSchema.parse({ code: 'launch-failed', message: 'Invocation failed.' }),
    }
    expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
    expect(
      decodeCommandResultEnvelope({ ...launchEnvelope, outcome }, command, correlationId).ok,
    ).toBe(false)
  })
})

describe('explicit folder selection interaction results', () => {
  test.each([{ kind: 'selected', path: '/workspace/with trailing space ' }, { kind: 'cancelled' }])(
    'preserves explicit $kind without cached state or path normalization',
    (result) => {
      const input = folderSuccess(result)
      expect(queryResultSchema.safeParse(input)).toMatchObject({ success: true, data: input })
      const envelope = folderEnvelope(input)
      expect(decodeQueryResultEnvelope(envelope, query, correlationId)).toEqual({
        ok: true,
        value: envelope,
      })
    },
  )

  test('keeps actual selector failure separate from successful cancellation', () => {
    const result = {
      operation: 'select-workspace',
      subject: { kind: 'none' },
      ...provenance,
      ok: false,
      error: selectionError,
    }
    const envelope = folderEnvelope(result)
    expect(decodeQueryResultEnvelope(envelope, query, correlationId)).toEqual({
      ok: true,
      value: envelope,
    })
    expect(
      queryResultSchema.safeParse(folderSuccess({ kind: 'cancelled', error: selectionError }))
        .success,
    ).toBe(false)
  })

  test('refuses folder read state and missing producer provenance', () => {
    const result = folderSuccess({ kind: 'cancelled' })
    expect(queryResultSchema.safeParse(result).success).toBe(true)
    expect(queryResultSchema.safeParse({ ...result, state: retainedState }).success).toBe(false)
    for (const field of ['operation', 'subject', 'serverEpoch', 'stateSequence']) {
      const malformed = { ...result }
      Reflect.deleteProperty(malformed, field)
      expect(queryResultSchema.safeParse(malformed).success).toBe(false)
    }
  })

  test.each([
    { kind: 'selected' },
    { kind: 'selected', path: null },
    { kind: 'cancelled', path: '/not-selected' },
    {},
  ])('refuses ambiguous selection payload %# instead of inventing cancellation', (result) => {
    expect(queryResultSchema.safeParse(folderSuccess({ kind: 'cancelled' })).success).toBe(true)
    expect(
      decodeQueryResultEnvelope(folderEnvelope(folderSuccess(result)), query, correlationId).ok,
    ).toBe(false)
  })

  test('refuses the obsolete absent-path cancellation acknowledgement', () => {
    expect(queryResultSchema.safeParse({ ok: true, type: 'workspace-selection' }).success).toBe(
      false,
    )
  })

  test('matches folder result correlation even when the result is cancellation', () => {
    const envelope = folderEnvelope(folderSuccess({ kind: 'cancelled' }))
    expect(decodeQueryResultEnvelope(envelope, query, correlationId).ok).toBe(true)
    expect(decodeQueryResultEnvelope(envelope, query, otherCorrelationId).ok).toBe(false)
  })
})

describe('finite server-owned launch admission', () => {
  test.each(['open-workspace', 'open-terminal', 'reveal-source'])(
    'admits %s with its required Project',
    (operation) => {
      const command = { ...launchCommand, operation }
      const input = { type: 'command', correlationId, command }
      expect(decodeCommandEnvelope(input)).toEqual({ ok: true, value: input })
    },
  )

  test('does not admit the obsolete arbitrary action ID authority', () => {
    expect(
      commandSchema.safeParse({ type: 'launch-action', ...version, actionId: 'execute-anything' })
        .success,
    ).toBe(false)
  })

  test.each([
    { type: 'launch-project-operation', ...version, operation: 'open-workspace' },
    { ...launchCommand, operation: 'execute-shell' },
    { ...launchCommand, project: { integration: 'remote', projectId: 'canonical-project' } },
    { ...launchCommand, project: { integration: 'local', id: 'canonical-project' } },
    { ...launchCommand, executable: '/bin/fixture' },
    { ...launchCommand, args: ['--fixture'] },
    { ...launchCommand, path: '/client-controlled/workspace' },
    { ...launchCommand, workspace: { path: '/client-controlled/workspace' } },
  ])('refuses malformed or client-owned launch authority %#', (command) => {
    expect(commandSchema.safeParse(launchCommand).success).toBe(true)
    expect(decodeCommandEnvelope({ type: 'command', correlationId, command }).ok).toBe(false)
  })

  test('requires Project identity in a projected server-launch action', () => {
    const action = {
      id: 'launch',
      kind: 'server-launch',
      label: 'Open workspace',
      project: projectRef,
      operation: 'open-workspace',
    }
    expect(projectActionSchema.safeParse(action)).toMatchObject({ success: true, data: action })
    const missing = { ...action }
    Reflect.deleteProperty(missing, 'project')
    expect(projectActionSchema.safeParse(missing).success).toBe(false)
  })

  test.each(['roadmap', 'external-link'])('does not admit a destination-free %s action', (kind) => {
    expect(projectActionSchema.safeParse({ id: 'link', kind, label: 'Open' }).success).toBe(false)
  })
})

describe('truthful source refresh attempts', () => {
  test('preserves a successful root time after an earlier failed nested-scope attempt', () => {
    const command = commandSchema.parse({
      type: 'refresh-project',
      ...version,
      project: projectRef,
    })
    const result = {
      type: 'refresh-project',
      project: projectRef,
      attempt: {
        kind: 'degraded',
        attemptedAt: 800,
        observedAt: 900,
        provenance: { integration: 'local', path: '/canonical/.wayfinder', operation: 'enumerate' },
        cause: 'Source path cannot be read.',
      },
    }
    const envelope = {
      type: 'command-result',
      correlationId,
      outcome: {
        operation: command.type,
        subject: { kind: 'project', project: projectRef },
        ...provenance,
        ok: true,
        result,
      },
    }
    expect(decodeCommandResultEnvelope(envelope, command, correlationId)).toEqual({
      ok: true,
      value: envelope,
    })
  })

  test.each(['observed', 'proven-absent'])(
    'refuses a completed %s observation before its own attempt',
    (kind) => {
      const attempt = {
        kind,
        attemptedAt: 800,
        observedAt: 900,
        provenance: { integration: 'local', path: '/canonical', operation: 'inspect-root' },
      }
      expect(refreshAttemptSchema.safeParse(attempt).success).toBe(true)
      expect(refreshAttemptSchema.safeParse({ ...attempt, observedAt: 799 }).success).toBe(false)
    },
  )

  test('refuses otherwise valid refresh provenance for a different integration', () => {
    const attempt = {
      kind: 'failed',
      attemptedAt: 900,
      provenance: {
        integration: 'github',
        connectionId,
        repositoryId: 'repository',
        stage: 'repository',
      },
      cause: 'GitHub access is currently unavailable.',
    }
    expect(refreshAttemptSchema.safeParse(attempt).success).toBe(true)
    expect(
      commandOutcomeSchema.safeParse({
        operation: 'refresh-project',
        subject: { kind: 'project', project: projectRef },
        ...provenance,
        ok: true,
        result: { type: 'refresh-project', project: projectRef, attempt },
      }).success,
    ).toBe(false)
  })
})

describe('new authorization versus subject-bound reauthorization', () => {
  test('admits new authorization without a Connection and refuses a hidden reauthorization subject', () => {
    const command = { type: 'begin-github-authorization', ...version, name: 'GitHub' }
    expect(commandSchema.safeParse(command)).toMatchObject({ success: true, data: command })
    expect(commandSchema.safeParse({ ...command, connectionId }).success).toBe(false)
  })

  test('requires the explicit existing Connection for reauthorization', () => {
    const command = { type: 'reauthorize-github-connection', ...version, connectionId }
    expect(commandSchema.safeParse(command)).toMatchObject({ success: true, data: command })
    const missing = { ...command }
    Reflect.deleteProperty(missing, 'connectionId')
    expect(commandSchema.safeParse(missing).success).toBe(false)
  })

  test.each([true, false])(
    'refuses another Connection reauthorization outcome with success=%s',
    (ok) => {
      const input = { type: 'reauthorize-github-connection', ...version, connectionId }
      expect(commandSchema.safeParse(input).success).toBe(true)
      const command = commandSchema.parse(input)
      const otherConnectionId = connectionIdSchema.parse('other-connection')
      const outcome = ok
        ? {
            operation: command.type,
            subject: { kind: 'connection', connectionId: otherConnectionId },
            ...provenance,
            ok: true,
            result: authorizationResult(command.type, {
              ...granted,
              connection: { ...granted.connection, connectionId: otherConnectionId },
            }),
          }
        : {
            operation: command.type,
            subject: { kind: 'connection', connectionId: otherConnectionId },
            ...provenance,
            ok: false,
            error: safeErrorSchema.parse({
              code: 'authorization-failed',
              message: 'Authorization failed.',
            }),
          }
      expect(commandOutcomeSchema.safeParse(outcome).success).toBe(true)
      expect(
        decodeCommandResultEnvelope(
          { type: 'command-result', correlationId, outcome },
          command,
          correlationId,
        ).ok,
      ).toBe(false)
    },
  )

  test.each([
    'begin-github-authorization',
    'reauthorize-github-connection',
    'retry-github-authorization',
    'cancel-github-authorization',
  ])('reports the actual waiting and granted phases for %s', (type) => {
    for (const phase of [waiting, granted]) {
      const result = authorizationResult(type, phase)
      expect(commandResultSchema.safeParse(result)).toMatchObject({ success: true, data: result })
    }
  })

  test.each(['verificationUri', 'userCode', 'expiresAt'])('refuses waiting without %s', (field) => {
    expect(
      commandResultSchema.safeParse(authorizationResult('begin-github-authorization', waiting))
        .success,
    ).toBe(true)
    const phase = { ...waiting }
    Reflect.deleteProperty(phase, field)
    expect(
      commandResultSchema.safeParse(authorizationResult('begin-github-authorization', phase))
        .success,
    ).toBe(false)
  })

  test.each(['connection', 'configurationVersion'])(
    'refuses granted without canonical %s',
    (field) => {
      expect(
        commandResultSchema.safeParse(authorizationResult('begin-github-authorization', granted))
          .success,
      ).toBe(true)
      const phase = { ...granted }
      Reflect.deleteProperty(phase, field)
      expect(
        commandResultSchema.safeParse(authorizationResult('begin-github-authorization', phase))
          .success,
      ).toBe(false)
    },
  )

  test.each(['denied', 'failed'])('requires a safe error in the actual %s phase', (status) => {
    const phase = {
      phase: status,
      error: safeErrorSchema.parse({
        code: 'authorization-failed',
        message: 'Authorization failed.',
      }),
    }
    expect(
      commandResultSchema.safeParse(authorizationResult('retry-github-authorization', phase))
        .success,
    ).toBe(true)
    expect(
      commandResultSchema.safeParse(
        authorizationResult('retry-github-authorization', { phase: status }),
      ).success,
    ).toBe(false)
  })

  test.each(['expired', 'cancelled'])(
    'preserves %s without fabricated failure or rollback',
    (status) => {
      const result = authorizationResult('cancel-github-authorization', { phase: status })
      expect(commandResultSchema.safeParse(result)).toMatchObject({ success: true, data: result })
      expect(
        commandResultSchema.safeParse(
          authorizationResult('cancel-github-authorization', {
            phase: status,
            error: selectionError,
          }),
        ).success,
      ).toBe(false)
    },
  )

  test.each([
    { ...waiting, connection: granted.connection, configurationVersion: committedVersion },
    {
      ...granted,
      verificationUri: waiting.verificationUri,
      userCode: waiting.userCode,
      expiresAt: waiting.expiresAt,
    },
    { ...granted, connection: { connectionId } },
    { ...granted, connection: { connectionId, accountId: '42', token: secret } },
  ])('refuses phase-invalid or credential-bearing authorization result %#', (phase) => {
    expect(
      commandResultSchema.safeParse(authorizationResult('begin-github-authorization', granted))
        .success,
    ).toBe(true)
    const parsed = commandResultSchema.safeParse(
      authorizationResult('begin-github-authorization', phase),
    )
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain(secret)
  })

  test('allows cancellation after grant to report the actual granted Connection', () => {
    const command = commandSchema.parse({
      type: 'cancel-github-authorization',
      ...version,
      operationId,
    })
    const outcome = {
      operation: command.type,
      subject: { kind: 'authorization', operationId },
      ...provenance,
      ok: true,
      result: authorizationResult(command.type, granted),
    }
    const envelope = { type: 'command-result', correlationId, outcome }
    expect(decodeCommandResultEnvelope(envelope, command, correlationId)).toEqual({
      ok: true,
      value: envelope,
    })
    const otherOperationId = authorizationOperationIdSchema.parse('another-operation')
    const wrong = {
      ...outcome,
      subject: { kind: 'authorization', operationId: otherOperationId },
      result: { ...outcome.result, operationId: otherOperationId },
    }
    expect(commandOutcomeSchema.safeParse(wrong).success).toBe(true)
    expect(
      decodeCommandResultEnvelope({ ...envelope, outcome: wrong }, command, correlationId).ok,
    ).toBe(false)
  })

  test('refuses a cancellation rejection for another authorization operation', () => {
    const command = commandSchema.parse({
      type: 'cancel-github-authorization',
      ...version,
      operationId,
    })
    const outcome = {
      operation: command.type,
      subject: { kind: 'authorization', operationId },
      ...provenance,
      ok: false,
      error: safeErrorSchema.parse({
        code: 'authorization-failed',
        message: 'Cancellation failed.',
      }),
    }
    const envelope = { type: 'command-result', correlationId, outcome }
    expect(decodeCommandResultEnvelope(envelope, command, correlationId).ok).toBe(true)
    const wrong = {
      ...outcome,
      subject: {
        kind: 'authorization',
        operationId: authorizationOperationIdSchema.parse('another-operation'),
      },
    }
    expect(commandOutcomeSchema.safeParse(wrong).success).toBe(true)
    expect(
      decodeCommandResultEnvelope({ ...envelope, outcome: wrong }, command, correlationId).ok,
    ).toBe(false)
  })
})

describe('correlated request and exact-field outgoing boundaries', () => {
  test('keeps correlation in the mandatory request envelope rather than the browser command', () => {
    const command = commandSchema.parse({ type: 'remove-project', ...version, project: projectRef })
    const input = { type: 'command', correlationId, command }
    expect(decodeCommandEnvelope(input)).toEqual({ ok: true, value: input })
    expect(decodeCommandEnvelope({ type: 'command', command }).ok).toBe(false)
    expect(commandSchema.safeParse({ ...command, correlationId }).success).toBe(false)
    const queryInput = { type: 'query', correlationId, query }
    expect(decodeQueryEnvelope(queryInput)).toEqual({ ok: true, value: queryInput })
    expect(decodeQueryEnvelope({ type: 'query', query }).ok).toBe(false)
  })

  test.each(['outcome', 'result', 'project'])(
    'refuses declared %s accessors without reading private values',
    (scope) => {
      let reads = 0
      const outcome = { ...launchOutcome, result: { ...launchResult, project: { ...projectRef } } }
      const destination =
        scope === 'outcome' ? outcome : scope === 'result' ? outcome.result : outcome.result.project
      const field = scope === 'outcome' ? 'operation' : scope === 'result' ? 'status' : 'projectId'
      Object.defineProperty(destination, field, {
        enumerable: true,
        get() {
          reads += 1
          throw new Error(secret)
        },
      })
      const decoded = decodeCommandResultEnvelope(
        { ...launchEnvelope, outcome },
        expectedLaunchCommand(),
        correlationId,
      )
      expect(decoded.ok).toBe(false)
      expect(reads).toBe(0)
      expect(JSON.stringify(decoded)).not.toContain(secret)
    },
  )

  test.each(['outcome', 'result', 'path'])(
    'refuses folder %s accessors without reading private values',
    (scope) => {
      let reads = 0
      const result = { kind: 'selected', path: '/selected' }
      const outcome = folderSuccess(result)
      Object.defineProperty(
        scope === 'outcome' ? outcome : result,
        scope === 'outcome' ? 'ok' : scope === 'result' ? 'kind' : 'path',
        {
          enumerable: true,
          get() {
            reads += 1
            throw new Error(secret)
          },
        },
      )
      const decoded = decodeQueryResultEnvelope(folderEnvelope(outcome), query, correlationId)
      expect(decoded.ok).toBe(false)
      expect(reads).toBe(0)
      expect(JSON.stringify(decoded)).not.toContain(secret)
    },
  )

  test.each(['token', 'credentials', 'harness', 'runtime', secret])(
    'refuses undeclared outgoing %s without diagnostic disclosure',
    (field) => {
      expect(commandOutcomeSchema.safeParse(launchOutcome).success).toBe(true)
      const inputs = [
        { ...launchEnvelope, [field]: secret },
        { ...launchEnvelope, outcome: { ...launchOutcome, [field]: secret } },
        {
          ...launchEnvelope,
          outcome: { ...launchOutcome, result: { ...launchResult, [field]: secret } },
        },
        {
          ...launchEnvelope,
          outcome: {
            ...launchOutcome,
            result: { ...launchResult, project: { ...project, [field]: secret } },
          },
        },
      ]
      for (const input of inputs) {
        const decoded = decodeCommandResultEnvelope(input, expectedLaunchCommand(), correlationId)
        expect(decoded.ok).toBe(false)
        expect(JSON.stringify(decoded)).not.toContain(secret)
        const parsed = commandOutcomeSchema.safeParse(input.outcome)
        expect(JSON.stringify(parsed)).not.toContain(secret)
      }
    },
  )

  test('does not read an outgoing credential accessor', () => {
    expect(commandOutcomeSchema.safeParse(launchOutcome).success).toBe(true)
    let reads = 0
    const outcome = Object.defineProperty({ ...launchOutcome }, 'credentials', {
      enumerable: true,
      get() {
        reads += 1
        throw new Error(secret)
      },
    })
    const decoded = decodeCommandResultEnvelope(
      { ...launchEnvelope, outcome },
      expectedLaunchCommand(),
      correlationId,
    )
    expect(decoded.ok).toBe(false)
    expect(reads).toBe(0)
    expect(JSON.stringify(decoded)).not.toContain(secret)
  })
})
