import type { z } from 'zod'
import { registeredProjectSchema } from './resources.ts'

export {
  activeMapSchema,
  mapMembershipSchema,
  mapResourceSchema,
  projectResourceSchema,
  registeredProjectResourcesSchema,
  ticketMembershipSchema,
  ticketResourceSchema,
} from './resources.ts'

import type {
  ApplicationState,
  CommandOutcome,
  ConfigurationIssue,
  QueryResult,
  RuntimeCodec,
} from './index.ts'

export interface StateEnvelope {
  type: 'state'
  state: ApplicationState
}

export interface QueryResultEnvelope {
  type: 'query-result'
  result: QueryResult
}

export interface CommandResultEnvelope {
  type: 'command-result'
  outcome: CommandOutcome
}

type Check = (input: unknown, path: string, issues: ConfigurationIssue[]) => boolean
interface Field {
  check: Check
  optional: boolean
}

function problem(issues: ConfigurationIssue[], path: string, message: string): false {
  issues.push({ path, message })
  return false
}

const stringValue: Check = (input, path, issues) =>
  typeof input === 'string' || problem(issues, path, 'must be a string')
const booleanValue: Check = (input, path, issues) =>
  typeof input === 'boolean' || problem(issues, path, 'must be a boolean')
const nonnegativeInteger: Check = (input, path, issues) =>
  (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0) ||
  problem(issues, path, 'must be a non-negative safe integer')
const nonnegativeNumber: Check = (input, path, issues) =>
  (typeof input === 'number' && Number.isFinite(input) && input >= 0) ||
  problem(issues, path, 'must be a non-negative finite number')

function literal(...values: readonly (string | boolean)[]): Check {
  return (input, path, issues) =>
    values.includes(input as string | boolean) ||
    problem(issues, path, `must be one of ${values.map(String).join(', ')}`)
}

function arrayOf(item: Check): Check {
  return (input, path, issues) => {
    if (!Array.isArray(input)) return problem(issues, path, 'must be an array')
    let valid = true
    for (const [index, value] of input.entries()) {
      if (!item(value, `${path}[${index}]`, issues)) valid = false
    }
    return valid
  }
}

function required(check: Check): Field {
  return { check, optional: false }
}

function optional(check: Check): Field {
  return { check, optional: true }
}

function object(fields: Record<string, Field>): Check {
  const allowed = new Set(Object.keys(fields))
  return (input, path, issues) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return problem(issues, path, 'must be an object')
    }
    return checkObjectFields(input as Record<string, unknown>, path, issues, fields, allowed)
  }
}

function checkObjectFields(
  value: Record<string, unknown>,
  path: string,
  issues: ConfigurationIssue[],
  fields: Record<string, Field>,
  allowed: ReadonlySet<string>,
): boolean {
  let valid = true
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) valid = problem(issues, `${path}.${key}`, 'is not allowed')
  }
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) {
      if (!field.optional) valid = problem(issues, `${path}.${key}`, 'is required')
      continue
    }
    if (field.optional && value[key] === undefined) continue
    if (!field.check(value[key], `${path}.${key}`, issues)) valid = false
  }
  return valid
}

function oneOf(name: string, ...checks: Check[]): Check {
  return (input, path, issues) => {
    for (const check of checks) {
      const branchIssues: ConfigurationIssue[] = []
      if (check(input, path, branchIssues)) return true
    }
    return problem(issues, path, `must match a ${name} variant`)
  }
}

function discriminated(name: string, key: string, variants: Record<string, Check>): Check {
  return (input, path, issues) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return problem(issues, path, 'must be an object')
    }
    const discriminator = Object.hasOwn(input, key)
      ? (input as Record<string, unknown>)[key]
      : undefined
    if (typeof discriminator !== 'string' || !Object.hasOwn(variants, discriminator)) {
      return problem(issues, `${path}.${key}`, `must identify a supported ${name} variant`)
    }
    const variant = variants[discriminator]
    return variant ? variant(input, path, issues) : false
  }
}

function codec<T>(check: Check): RuntimeCodec<T> {
  return {
    decode(input) {
      const issues: ConfigurationIssue[] = []
      return check(input, '$', issues) ? { ok: true, value: input as T } : { ok: false, issues }
    },
  }
}

const integration = literal('github', 'local')
const projectKey = object({ integration: required(integration), id: required(stringValue) })
function schemaCheck(schema: z.ZodType): Check {
  return (input, path, issues) => {
    const result = schema.safeParse(input)
    if (result.success) return true
    for (const issue of result.error.issues) {
      problem(issues, path + issue.path.map((key) => `.${String(key)}`).join(''), issue.message)
    }
    return false
  }
}
const publication = object({ capturedAt: required(nonnegativeNumber) })
const connectionAvailability = discriminated('Connection availability', 'status', {
  available: object({
    status: required(literal('available')),
    observedAt: optional(nonnegativeNumber),
  }),
  degraded: object({
    status: required(literal('degraded')),
    cause: required(stringValue),
    observedAt: required(nonnegativeNumber),
  }),
  'authorization-required': object({
    status: required(literal('authorization-required')),
    cause: required(stringValue),
    observedAt: optional(nonnegativeNumber),
  }),
  unavailable: object({
    status: required(literal('unavailable')),
    cause: required(stringValue),
    observedAt: optional(nonnegativeNumber),
  }),
})
const githubIdentity = object({ id: required(stringValue), login: required(stringValue) })
const connection = object({
  id: required(stringValue),
  integration: required(integration),
  name: required(stringValue),
  builtIn: required(booleanValue),
  githubIdentity: optional(githubIdentity),
  availability: required(connectionAvailability),
})
const projectLocator = discriminated('Project locator', 'integration', {
  github: object({
    integration: required(literal('github')),
    repositoryId: required(stringValue),
    nameWithOwner: required(stringValue),
  }),
  local: object({ integration: required(literal('local')), path: required(stringValue) }),
})
const workspace = object({ path: required(stringValue), gitIdentity: optional(stringValue) })
const registration = object({
  key: required(projectKey),
  connectionId: required(stringValue),
  locator: required(projectLocator),
  workspace: required(workspace),
  displayName: optional(stringValue),
})
const registeredProject = schemaCheck(registeredProjectSchema)
const supportedIntegration = discriminated('supported Integration', 'integration', {
  local: object({
    integration: required(literal('local')),
    name: required(stringValue),
    connectionKind: required(literal('built-in')),
  }),
  github: object({
    integration: required(literal('github')),
    name: required(stringValue),
    connectionKind: required(literal('device-authorization')),
    newInstallationUrl: required(stringValue),
    installationsUrl: required(stringValue),
    authorizationsUrl: required(stringValue),
  }),
})
const authorizationOperation = object({
  id: required(stringValue),
  connectionId: optional(stringValue),
  status: required(literal('waiting', 'granted', 'denied', 'expired', 'cancelled', 'failed')),
  verificationUri: optional(stringValue),
  userCode: optional(stringValue),
  expiresAt: optional(nonnegativeNumber),
  cause: optional(stringValue),
})
const configurationIssue = object({ path: required(stringValue), message: required(stringValue) })
const configurationStatus = object({
  valid: required(booleanValue),
  issues: required(arrayOf(configurationIssue)),
  notices: required(arrayOf(stringValue)),
})
const automationAvailability = discriminated('Automation availability', 'status', {
  ready: object({ status: required(literal('ready')) }),
  unavailable: object({
    status: required(literal('unavailable')),
    cause: required(stringValue),
  }),
})
const automationAdmission = literal('automatic', 'override')
const automationProcessResult = discriminated('Automation process result', 'status', {
  exited: object({
    status: required(literal('exited')),
    code: required(nonnegativeInteger),
  }),
  signaled: object({
    status: required(literal('signaled')),
    signal: required(stringValue),
  }),
  unavailable: object({
    status: required(literal('unavailable')),
    reason: required(stringValue),
  }),
})
const classificationVerdict = object({
  value: required(literal('afk', 'hitl', 'unable')),
  reason: required(stringValue),
})
const classificationAttempt = discriminated('Classification attempt', 'status', {
  running: object({
    status: required(literal('running')),
    admission: required(automationAdmission),
  }),
  completed: object({
    status: required(literal('completed')),
    admission: required(automationAdmission),
    processResult: required(automationProcessResult),
    verdict: required(classificationVerdict),
  }),
  failed: object({
    status: required(literal('failed')),
    admission: required(automationAdmission),
    processResult: required(automationProcessResult),
    reason: required(stringValue),
  }),
  'launch-failed': object({
    status: required(literal('launch-failed')),
    admission: required(automationAdmission),
    reason: required(stringValue),
  }),
  'outcome-unknown': object({
    status: required(literal('outcome-unknown')),
    admission: required(automationAdmission),
    reason: required(stringValue),
  }),
})
const sessionReport = object({
  outcome: required(literal('completed', 'stopped', 'failed')),
  reason: required(stringValue),
})
const sessionReportEvidence = discriminated('Session report evidence', 'status', {
  received: object({
    status: required(literal('received')),
    report: required(sessionReport),
  }),
  missing: object({
    status: required(literal('missing')),
    reason: required(stringValue),
  }),
  invalid: object({
    status: required(literal('invalid')),
    reason: required(stringValue),
  }),
})
const wayfinderSession = discriminated('Wayfinder Session', 'status', {
  queued: object({ status: required(literal('queued')) }),
  launching: object({
    status: required(literal('launching')),
    admission: required(automationAdmission),
  }),
  running: object({
    status: required(literal('running')),
    admission: required(automationAdmission),
  }),
  finished: object({
    status: required(literal('finished')),
    admission: required(automationAdmission),
    processResult: required(automationProcessResult),
    report: required(sessionReportEvidence),
  }),
  'launch-failed': object({
    status: required(literal('launch-failed')),
    admission: required(automationAdmission),
    reason: required(stringValue),
  }),
  'outcome-unknown': object({
    status: required(literal('outcome-unknown')),
    admission: required(automationAdmission),
    reason: required(stringValue),
    acknowledged: required(booleanValue),
  }),
})
const automationTarget = object({
  project: required(projectKey),
  mapId: required(stringValue),
  ticketId: required(stringValue),
})
const automationEvidence = object({
  target: required(automationTarget),
  classification: required(classificationAttempt),
  wayfinder: optional(wayfinderSession),
})
const automationOverrideAvailability = discriminated('Automation override availability', 'status', {
  eligible: object({ status: required(literal('eligible')) }),
  ineligible: object({
    status: required(literal('ineligible')),
    reason: required(stringValue),
  }),
})
const automationOverrideControl = object({
  target: required(automationTarget),
  classification: required(automationOverrideAvailability),
  wayfinder: required(automationOverrideAvailability),
})

const automationState = object({
  enabled: required(booleanValue),
  enabledProjects: required(arrayOf(projectKey)),
  availability: required(automationAvailability),
  evidence: required(arrayOf(automationEvidence)),
  overrides: required(arrayOf(automationOverrideControl)),
})
const safeError = object({
  code: required(
    literal(
      'conflict',
      'configuration-invalid',
      'validation',
      'dependency',
      'admission-failed',
      'authorization-failed',
      'persistence-failed',
      'launch-failed',
      'selection-failed',
      'not-supported',
      'transport-failed',
    ),
  ),
  message: required(stringValue),
  field: optional(stringValue),
  dependentProjects: optional(arrayOf(projectKey)),
})
const applicationState = object({
  serverEpoch: required(stringValue),
  stateSequence: required(nonnegativeInteger),
  configurationVersion: required(nonnegativeInteger),
  supportedIntegrations: required(arrayOf(supportedIntegration)),
  connections: required(arrayOf(connection)),
  registrations: required(arrayOf(registration)),
  projects: required(arrayOf(registeredProject)),
  authorizationOperations: required(arrayOf(authorizationOperation)),
  configuration: required(configurationStatus),
  automation: required(automationState),
  roadmap: required(publication),
})
const queryResult = oneOf(
  'query result',
  object({
    ok: required(literal(true)),
    type: required(literal('workspace-selection')),
    path: optional(stringValue),
  }),
  object({ ok: required(literal(false)), error: required(safeError) }),
)
const commandResult = discriminated('command result', 'type', {
  'configuration-updated': object({
    type: required(literal('configuration-updated')),
    configurationVersion: required(nonnegativeInteger),
  }),
  'authorization-started': object({
    type: required(literal('authorization-started')),
    operationId: required(stringValue),
  }),
  'authorization-cancelled': object({
    type: required(literal('authorization-cancelled')),
    operationId: required(stringValue),
  }),
  'project-refreshed': object({
    type: required(literal('project-refreshed')),
    project: required(projectKey),
  }),
  'action-launched': object({
    type: required(literal('action-launched')),
    actionId: required(stringValue),
  }),
  'automation-override-started': object({
    type: required(literal('automation-override-started')),
    target: required(automationTarget),
    stage: required(literal('classification', 'wayfinder')),
  }),
})
const commandOutcome = oneOf(
  'command outcome',
  object({
    ok: required(literal(true)),
    result: required(commandResult),
    state: required(applicationState),
  }),
  object({
    ok: required(literal(false)),
    error: required(safeError),
    state: required(applicationState),
  }),
)

export const applicationStateCodec = codec<ApplicationState>(applicationState)
export const stateEnvelopeCodec = codec<StateEnvelope>(
  object({ type: required(literal('state')), state: required(applicationState) }),
)
export const queryResultEnvelopeCodec = codec<QueryResultEnvelope>(
  object({ type: required(literal('query-result')), result: required(queryResult) }),
)
export const commandResultEnvelopeCodec = codec<CommandResultEnvelope>(
  object({ type: required(literal('command-result')), outcome: required(commandOutcome) }),
)
