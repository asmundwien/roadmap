import type {
  ApplicationState,
  Command,
  CommandOutcome,
  ConfigurationIssue,
  Query,
  QueryResult,
  RuntimeCodec,
} from './index.ts'

export interface StateEnvelope {
  type: 'state'
  state: ApplicationState
}

export interface QueryEnvelope {
  type: 'query'
  query: Query
}

export interface QueryResultEnvelope {
  type: 'query-result'
  result: QueryResult
}

export interface CommandEnvelope {
  type: 'command'
  command: Command
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
const nullableString: Check = (input, path, issues) =>
  input === null || stringValue(input, path, issues)

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
    if (!(key in value)) {
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
    const discriminator = (input as Record<string, unknown>)[key]
    if (typeof discriminator !== 'string' || !(discriminator in variants)) {
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
const assignee = object({
  name: required(stringValue),
  url: optional(stringValue),
  avatarUrl: optional(stringValue),
})
const blocker = object({
  project: required(projectKey),
  ticketId: required(stringValue),
  displayId: optional(stringValue),
  title: optional(stringValue),
  url: optional(stringValue),
  state: required(literal('open', 'closed', 'unknown')),
})
const ticketTypeEvidence = discriminated('ticket type evidence', 'kind', {
  recognized: object({
    kind: required(literal('recognized')),
    value: required(literal('research', 'prototype', 'grilling', 'task')),
    labels: required(arrayOf(stringValue)),
  }),
  missing: object({ kind: required(literal('missing')), labels: required(arrayOf(stringValue)) }),
  unknown: object({ kind: required(literal('unknown')), labels: required(arrayOf(stringValue)) }),
  conflicting: object({
    kind: required(literal('conflicting')),
    labels: required(arrayOf(stringValue)),
  }),
})
const ticket = object({
  id: required(stringValue),
  displayId: optional(stringValue),
  title: optional(stringValue),
  url: optional(stringValue),
  body: required(stringValue),
  typeEvidence: required(ticketTypeEvidence),
  state: required(literal('closed', 'blocked', 'claimed', 'frontier')),
  isClaimed: required(booleanValue),
  isBlocked: required(booleanValue),
  createdAt: optional(nonnegativeNumber),
  closedAt: optional(nonnegativeNumber),
  assignees: required(arrayOf(assignee)),
  blockedBy: required(arrayOf(blocker)),
  blockersComplete: required(booleanValue),
  warnings: required(arrayOf(stringValue)),
  sourcePath: optional(stringValue),
})
const decision = object({
  title: required(stringValue),
  url: required(nullableString),
  gist: required(stringValue),
  raw: required(stringValue),
})
const mapSection = object({
  heading: required(stringValue),
  text: required(stringValue),
  items: required(arrayOf(stringValue)),
})
const mapBody = object({
  raw: required(stringValue),
  destination: required(stringValue),
  notes: required(arrayOf(stringValue)),
  decisions: required(arrayOf(decision)),
  notYetSpecified: required(arrayOf(stringValue)),
  notYetSpecifiedNote: required(stringValue),
  outOfScope: required(arrayOf(stringValue)),
  sections: required(arrayOf(mapSection)),
  missingSections: required(arrayOf(stringValue)),
})
const mapProgress = object({
  total: required(nonnegativeInteger),
  completed: required(nonnegativeInteger),
})
const wayfinderMap = object({
  project: required(projectKey),
  id: required(stringValue),
  displayId: optional(stringValue),
  title: optional(stringValue),
  url: optional(stringValue),
  isOpen: required(booleanValue),
  updatedAt: required(nonnegativeNumber),
  closedAt: optional(nonnegativeNumber),
  body: required(mapBody),
  tickets: required(arrayOf(ticket)),
  frontier: required(arrayOf(ticket)),
  progress: required(mapProgress),
  ticketsComplete: required(booleanValue),
  warnings: required(arrayOf(stringValue)),
  sourcePath: optional(stringValue),
})
const project = object({
  key: required(projectKey),
  name: required(stringValue),
  visibility: optional(literal('public', 'private')),
  openMaps: required(arrayOf(wayfinderMap)),
  closedMaps: required(arrayOf(wayfinderMap)),
  warnings: required(arrayOf(stringValue)),
  sourcePath: optional(stringValue),
  sourceUrl: optional(stringValue),
})
const unreachable = object({
  integration: required(integration),
  project: required(projectKey),
  projectName: optional(stringValue),
  mapId: optional(stringValue),
  mapDisplayId: optional(stringValue),
  mapTitle: optional(stringValue),
  reason: required(stringValue),
})
const snapshot = object({
  capturedAt: required(nonnegativeNumber),
  projects: required(arrayOf(project)),
  unreachable: required(arrayOf(unreachable)),
})
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
const registrationCandidate = object({
  integration: required(integration),
  connectionId: required(stringValue),
  workspace: required(object({ path: required(stringValue) })),
  displayName: optional(stringValue),
})
const registration = object({
  key: required(projectKey),
  connectionId: required(stringValue),
  locator: required(projectLocator),
  workspace: required(workspace),
  displayName: optional(stringValue),
})
const projectAvailability = discriminated('Project availability', 'status', {
  available: object({
    status: required(literal('available')),
    observedAt: required(nonnegativeNumber),
  }),
  unavailable: object({
    status: required(literal('unavailable')),
    cause: required(stringValue),
    observedAt: optional(nonnegativeNumber),
  }),
})
const projectAction = object({
  id: required(stringValue),
  label: required(stringValue),
  kind: required(literal('roadmap', 'external-link', 'server-launch')),
  href: optional(stringValue),
})
const registeredProject = object({
  key: required(projectKey),
  connectionId: required(stringValue),
  locator: required(projectLocator),
  workspace: required(workspace),
  displayName: optional(stringValue),
  name: required(stringValue),
  availability: required(projectAvailability),
  openMaps: required(arrayOf(wayfinderMap)),
  closedMaps: required(arrayOf(wayfinderMap)),
  warnings: required(arrayOf(stringValue)),
  actions: required(arrayOf(projectAction)),
})
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
  roadmap: required(snapshot),
})
const query = discriminated('query', 'type', {
  'select-workspace': object({ type: required(literal('select-workspace')) }),
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
const version = { expectedConfigurationVersion: required(nonnegativeInteger) }
const command = discriminated('command', 'type', {
  'begin-github-authorization': object({
    type: required(literal('begin-github-authorization')),
    ...version,
    name: required(stringValue),
    connectionId: optional(stringValue),
  }),
  'cancel-github-authorization': object({
    type: required(literal('cancel-github-authorization')),
    ...version,
    operationId: required(stringValue),
  }),
  'retry-github-authorization': object({
    type: required(literal('retry-github-authorization')),
    ...version,
    operationId: required(stringValue),
  }),
  'rename-connection': object({
    type: required(literal('rename-connection')),
    ...version,
    connectionId: required(stringValue),
    name: required(stringValue),
  }),
  'remove-connection': object({
    type: required(literal('remove-connection')),
    ...version,
    connectionId: required(stringValue),
  }),
  'register-project': object({
    type: required(literal('register-project')),
    ...version,
    candidate: required(registrationCandidate),
  }),
  'rename-project': object({
    type: required(literal('rename-project')),
    ...version,
    project: required(projectKey),
    name: required(stringValue),
  }),
  'repair-project-workspace': object({
    type: required(literal('repair-project-workspace')),
    ...version,
    project: required(projectKey),
    workspace: required(workspace),
  }),
  'remove-project': object({
    type: required(literal('remove-project')),
    ...version,
    project: required(projectKey),
  }),
  'set-automation-enabled': object({
    type: required(literal('set-automation-enabled')),
    ...version,
    enabled: required(booleanValue),
  }),
  'set-project-automation-enabled': object({
    type: required(literal('set-project-automation-enabled')),
    ...version,
    project: required(projectKey),
    enabled: required(booleanValue),
  }),
  'start-automation-override': object({
    type: required(literal('start-automation-override')),
    ...version,
    target: required(automationTarget),
    stage: required(literal('classification', 'wayfinder')),
  }),
  'refresh-project': object({
    type: required(literal('refresh-project')),
    ...version,
    project: required(projectKey),
  }),
  'launch-action': object({
    type: required(literal('launch-action')),
    ...version,
    actionId: required(stringValue),
    project: optional(projectKey),
  }),
})
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
export const queryEnvelopeCodec = codec<QueryEnvelope>(
  object({ type: required(literal('query')), query: required(query) }),
)
export const queryResultEnvelopeCodec = codec<QueryResultEnvelope>(
  object({ type: required(literal('query-result')), result: required(queryResult) }),
)
export const commandEnvelopeCodec = codec<CommandEnvelope>(
  object({ type: required(literal('command')), command: required(command) }),
)
export const commandResultEnvelopeCodec = codec<CommandResultEnvelope>(
  object({ type: required(literal('command-result')), outcome: required(commandOutcome) }),
)
