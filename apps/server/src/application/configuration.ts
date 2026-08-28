import { randomUUID } from 'node:crypto'
import { type FSWatcher, watch } from 'node:fs'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import type {
  ConfigurationIssue,
  GitHubConnectionIdentity,
  Integration,
  ProjectKey,
  ProjectRegistration,
  RuntimeCodec,
} from '@roadmap/contracts'
import { isRecord } from '../type-guards.ts'
import { CLASSIFICATION_RESULT_SCHEMA_MARKER } from './classification-contract.ts'
import {
  type ConfigurationMigration,
  type LegacyRoadmapConfiguration,
  migrateConfigurationV1,
  migrateConfigurationV2,
  migrateConfigurationV3,
  migrateConfigurationV4,
} from './migration.ts'
import { SESSION_REPORT_SCHEMA_MARKER } from './session-report-contract.ts'

export interface ConfiguredConnection {
  id: string
  integration: Integration
  name: string
  builtIn: boolean
  githubIdentity?: GitHubConnectionIdentity
}

export interface LegacyHarnessCommand {
  command: string
  args: string[]
  promptDelivery: 'argument' | 'stdin'
}

export interface HarnessCommand extends LegacyHarnessCommand {
  promptTemplate: string
}

export interface LegacyClassificationConfiguration {
  command?: LegacyHarnessCommand
  enabledProjects: ProjectKey[]
}

export interface LegacyRoadmapConfigurationV3 {
  schemaVersion: 3
  configurationVersion: number
  connections: ConfiguredConnection[]
  projects: ProjectRegistration[]
  classification: LegacyClassificationConfiguration
}

export interface LegacyAutomationConfiguration {
  enabled: boolean
  classificationCommand?: LegacyHarnessCommand
  wayfinderCommand?: LegacyHarnessCommand
  enabledProjects: ProjectKey[]
}

export interface LegacyRoadmapConfigurationV4 {
  schemaVersion: 4
  configurationVersion: number
  connections: ConfiguredConnection[]
  projects: ProjectRegistration[]
  automation: LegacyAutomationConfiguration
}

export interface AutomationConfiguration {
  enabled: boolean
  classificationCommand?: HarnessCommand
  wayfinderCommand?: HarnessCommand
  enabledProjects: ProjectKey[]
}

export interface RoadmapConfiguration {
  schemaVersion: 5
  configurationVersion: number
  connections: ConfiguredConnection[]
  projects: ProjectRegistration[]
  automation: AutomationConfiguration
}

const POINTER_PROMPT_MARKERS = ['{{roadmap.map}}', '{{roadmap.ticket}}']
const CLASSIFICATION_PROMPT_MARKERS = [
  ...POINTER_PROMPT_MARKERS,
  CLASSIFICATION_RESULT_SCHEMA_MARKER,
]
const WAYFINDER_PROMPT_MARKERS = [...POINTER_PROMPT_MARKERS, SESSION_REPORT_SCHEMA_MARKER]

export type ConfigurationRead =
  | { ok: true; document: RoadmapConfiguration; notices?: string[] }
  | { ok: false; issues: ConfigurationIssue[] }

export type ConfigurationWrite =
  | { ok: true }
  | { ok: false; kind: 'conflict' | 'persistence'; message: string }

export interface ConfigurationDocument {
  load(): Promise<ConfigurationRead>
  subscribe(listener: (result: ConfigurationRead) => void): () => void
  write(document: RoadmapConfiguration): Promise<ConfigurationWrite>
  stop(): Promise<void>
}

const FORBIDDEN_SECRET_KEY = /(?:token|secret|password|credential|private.?key)/i

function configurationCodec(
  schemaVersion: 1 | 2,
  requireReservedLocal: boolean,
): RuntimeCodec<LegacyRoadmapConfiguration>
function configurationCodec(
  schemaVersion: 3,
  requireReservedLocal: boolean,
): RuntimeCodec<LegacyRoadmapConfigurationV3>
function configurationCodec(
  schemaVersion: 4,
  requireReservedLocal: boolean,
): RuntimeCodec<LegacyRoadmapConfigurationV4>
function configurationCodec(
  schemaVersion: 5,
  requireReservedLocal: boolean,
): RuntimeCodec<RoadmapConfiguration>
function configurationCodec(
  schemaVersion: 1 | 2 | 3 | 4 | 5,
  requireReservedLocal: boolean,
): RuntimeCodec<
  | LegacyRoadmapConfiguration
  | LegacyRoadmapConfigurationV3
  | LegacyRoadmapConfigurationV4
  | RoadmapConfiguration
> {
  return {
    decode(input) {
      return decodeConfiguration(input, schemaVersion, requireReservedLocal)
    },
  }
}

type ConfigurationValue =
  | LegacyRoadmapConfiguration
  | LegacyRoadmapConfigurationV3
  | LegacyRoadmapConfigurationV4
  | RoadmapConfiguration

type ConfigurationDecode =
  | { ok: true; value: ConfigurationValue }
  | { ok: false; issues: ConfigurationIssue[] }

interface DecodedConfigurationBase {
  root: Record<string, unknown>
  configurationVersion: number | null
  connections: ConfiguredConnection[]
  projects: ProjectRegistration[]
}

function decodeConfiguration(
  input: unknown,
  schemaVersion: 1 | 2 | 3 | 4 | 5,
  requireReservedLocal: boolean,
): ConfigurationDecode {
  const issues: ConfigurationIssue[] = []
  rejectSecrets(input, '$', issues)
  const root = asRecord(input, '$', issues)
  if (!root) return { ok: false, issues }

  exactKeys(root, configurationKeys(schemaVersion), '$', issues)
  if (root.schemaVersion !== schemaVersion) {
    issue(issues, '$.schemaVersion', `Must be ${schemaVersion}.`)
  }
  const base: DecodedConfigurationBase = {
    root,
    configurationVersion: integer(root.configurationVersion, '$.configurationVersion', issues),
    connections: decodeConnections(root.connections, issues),
    projects: decodeProjects(root.projects, issues),
  }
  if (schemaVersion === 5) return decodeCurrentConfiguration(base, issues, requireReservedLocal)
  if (schemaVersion === 4) return decodeVersionFour(base, issues, requireReservedLocal)
  if (schemaVersion === 3) return decodeVersionThree(base, issues, requireReservedLocal)
  return decodeLegacyConfiguration(base, issues, requireReservedLocal, schemaVersion)
}

function decodeConnections(input: unknown, issues: ConfigurationIssue[]): ConfiguredConnection[] {
  return array(input, '$.connections', issues).flatMap((value, index) => {
    const connection = decodeConnection(value, `$.connections[${index}]`, issues)
    return connection ? [connection] : []
  })
}

function decodeProjects(input: unknown, issues: ConfigurationIssue[]): ProjectRegistration[] {
  return array(input, '$.projects', issues).flatMap((value, index) => {
    const project = decodeRegistration(value, `$.projects[${index}]`, issues)
    return project ? [project] : []
  })
}

function decodeCurrentConfiguration(
  base: DecodedConfigurationBase,
  issues: ConfigurationIssue[],
  requireReservedLocal: boolean,
): ConfigurationDecode {
  const automation = decodeAutomation(base.root.automation, '$.automation', issues)
  validateSemantics(
    base.connections,
    base.projects,
    automation?.enabledProjects ?? null,
    issues,
    requireReservedLocal,
    '$.automation.enabledProjects',
  )
  if (issues.length > 0 || base.configurationVersion === null || !automation) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    value: {
      schemaVersion: 5,
      configurationVersion: base.configurationVersion,
      connections: base.connections,
      projects: base.projects,
      automation,
    },
  }
}

function decodeVersionFour(
  base: DecodedConfigurationBase,
  issues: ConfigurationIssue[],
  requireReservedLocal: boolean,
): ConfigurationDecode {
  const automation = decodeLegacyAutomation(base.root.automation, '$.automation', issues)
  validateSemantics(
    base.connections,
    base.projects,
    automation?.enabledProjects ?? null,
    issues,
    requireReservedLocal,
    '$.automation.enabledProjects',
  )
  if (issues.length > 0 || base.configurationVersion === null || !automation) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    value: {
      schemaVersion: 4,
      configurationVersion: base.configurationVersion,
      connections: base.connections,
      projects: base.projects,
      automation,
    },
  }
}

function decodeVersionThree(
  base: DecodedConfigurationBase,
  issues: ConfigurationIssue[],
  requireReservedLocal: boolean,
): ConfigurationDecode {
  const classification = decodeClassification(base.root.classification, '$.classification', issues)
  validateSemantics(
    base.connections,
    base.projects,
    classification?.enabledProjects ?? null,
    issues,
    requireReservedLocal,
    '$.classification.enabledProjects',
  )
  if (issues.length > 0 || base.configurationVersion === null || !classification) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    value: {
      schemaVersion: 3,
      configurationVersion: base.configurationVersion,
      connections: base.connections,
      projects: base.projects,
      classification,
    },
  }
}

function decodeLegacyConfiguration(
  base: DecodedConfigurationBase,
  issues: ConfigurationIssue[],
  requireReservedLocal: boolean,
  schemaVersion: 1 | 2,
): ConfigurationDecode {
  validateSemantics(
    base.connections,
    base.projects,
    null,
    issues,
    requireReservedLocal,
    '$.classification.enabledProjects',
  )
  if (issues.length > 0 || base.configurationVersion === null) return { ok: false, issues }
  return {
    ok: true,
    value: {
      schemaVersion,
      configurationVersion: base.configurationVersion,
      connections: base.connections,
      projects: base.projects,
    },
  }
}

function configurationKeys(schemaVersion: 1 | 2 | 3 | 4 | 5): string[] {
  const keys = ['schemaVersion', 'configurationVersion', 'connections', 'projects']
  if (schemaVersion === 3) return [...keys, 'classification']
  return schemaVersion === 4 || schemaVersion === 5 ? [...keys, 'automation'] : keys
}

export const roadmapConfigurationCodec = configurationCodec(5, true)
const legacyConfigurationV1Codec = configurationCodec(1, false)
const legacyConfigurationV2Codec = configurationCodec(2, true)
const legacyConfigurationV3Codec = configurationCodec(3, true)
const legacyConfigurationV4Codec = configurationCodec(4, true)

async function readConfigurationSource(
  path: string,
): Promise<{ ok: true; raw: string } | { ok: false; issues: ConfigurationIssue[] }> {
  try {
    return { ok: true, raw: await readFile(path, 'utf8') }
  } catch (error) {
    if (!isMissing(error)) {
      return { ok: false, issues: [{ path: '$', message: safeMessage(error) }] }
    }
    return {
      ok: true,
      raw: `${JSON.stringify(
        { schemaVersion: 1, configurationVersion: 0, connections: [], projects: [] },
        null,
        2,
      )}\n`,
    }
  }
}

function parseConfigurationSource(
  raw: string,
): { ok: true; value: unknown } | { ok: false; issues: ConfigurationIssue[] } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, issues: [{ path: '$', message: 'Invalid JSON.' }] }
  }
}

type MigrationDecode =
  | { ok: true; value: ConfigurationMigration }
  | { ok: false; issues: ConfigurationIssue[] }

async function decodeMigration(
  parsed: unknown,
  version: 1 | 2 | 3 | 4,
  legacyLocalProjectsPath: string,
): Promise<MigrationDecode> {
  if (version === 4) {
    const legacy = legacyConfigurationV4Codec.decode(parsed)
    return legacy.ok ? { ok: true, value: migrateConfigurationV4(legacy.value) } : legacy
  }
  if (version === 3) {
    const legacy = legacyConfigurationV3Codec.decode(parsed)
    return legacy.ok ? { ok: true, value: migrateConfigurationV3(legacy.value) } : legacy
  }
  const legacyCodec = version === 1 ? legacyConfigurationV1Codec : legacyConfigurationV2Codec
  const legacy = legacyCodec.decode(parsed)
  if (!legacy.ok) return legacy
  const value =
    version === 1
      ? await migrateConfigurationV1(legacy.value, legacyLocalProjectsPath)
      : migrateConfigurationV2(legacy.value)
  return { ok: true, value }
}

export function createConfigurationDocument(
  path: string,
  options: { debounceMs?: number; legacyLocalProjectsPath?: string } = {},
): ConfigurationDocument {
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const debounceMs = options.debounceMs ?? 100
  let watcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let lastRaw: string | null = null
  let lastPublishedFingerprint = ''
  let writeChain: Promise<ConfigurationWrite> = Promise.resolve({ ok: true })

  async function migrateCurrent(
    raw: string,
    parsed: unknown,
    version: 1 | 2 | 3 | 4,
  ): Promise<ConfigurationRead> {
    const migrated = await decodeMigration(
      parsed,
      version,
      options.legacyLocalProjectsPath ?? join(dirname(path), 'local-projects.json'),
    )
    if (!migrated.ok) {
      lastRaw = raw
      return migrated
    }
    const decoded = roadmapConfigurationCodec.decode(migrated.value.document)
    if (!decoded.ok) {
      lastRaw = raw
      return decoded
    }
    const migratedRaw = serializeConfiguration(decoded.value)
    const persisted = await atomicWrite(path, migratedRaw)
    if (!persisted.ok) {
      lastRaw = raw
      return { ok: false, issues: [{ path: '$', message: persisted.message }] }
    }
    lastRaw = migratedRaw
    return {
      ok: true,
      document: decoded.value,
      ...(migrated.value.notices.length > 0 ? { notices: migrated.value.notices } : {}),
    }
  }

  async function readCurrent(): Promise<ConfigurationRead> {
    const source = await readConfigurationSource(path)
    if (!source.ok) return source
    const parsed = parseConfigurationSource(source.raw)
    if (!parsed.ok) {
      lastRaw = source.raw
      return parsed
    }
    if (
      isRecord(parsed.value) &&
      (parsed.value.schemaVersion === 1 ||
        parsed.value.schemaVersion === 2 ||
        parsed.value.schemaVersion === 3 ||
        parsed.value.schemaVersion === 4)
    ) {
      return migrateCurrent(source.raw, parsed.value, parsed.value.schemaVersion)
    }

    lastRaw = source.raw
    const decoded = roadmapConfigurationCodec.decode(parsed.value)
    return decoded.ok ? { ok: true, document: decoded.value } : decoded
  }

  function publish(result: ConfigurationRead): void {
    const fingerprint = JSON.stringify(result)
    if (fingerprint === lastPublishedFingerprint) return
    lastPublishedFingerprint = fingerprint
    for (const listener of listeners) listener(result)
  }

  async function reload(): Promise<void> {
    if (stopped) return
    publish(await readCurrent())
  }

  function scheduleReload(changedFile: string | null): void {
    if (stopped || (changedFile !== null && changedFile !== basename(path))) return
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void reload()
    }, debounceMs)
  }

  function ensureWatcher(): void {
    if (watcher !== null || stopped) return
    watcher = watch(dirname(path), (event, changedFile) => {
      void event
      scheduleReload(changedFile?.toString() ?? null)
    })
    watcher.on('error', (error) => {
      publish({ ok: false, issues: [{ path: '$', message: safeMessage(error) }] })
    })
  }

  async function writeOne(document: RoadmapConfiguration): Promise<ConfigurationWrite> {
    if (stopped) return { ok: false, kind: 'persistence', message: 'Configuration is stopped.' }
    let diskRaw: string | null
    try {
      diskRaw = await readFile(path, 'utf8')
    } catch (error) {
      diskRaw = isMissing(error) ? null : lastRaw
      if (!isMissing(error)) {
        return { ok: false, kind: 'persistence', message: safeMessage(error) }
      }
    }
    if (lastRaw !== null && diskRaw !== lastRaw) {
      return {
        ok: false,
        kind: 'conflict',
        message: 'roadmap.config.json changed on disk; wait for it to be applied and retry.',
      }
    }

    const raw = serializeConfiguration(document)
    const result = await atomicWrite(path, raw)
    if (!result.ok) return result
    lastRaw = raw
    publish({ ok: true, document })
    return { ok: true }
  }

  return {
    async load() {
      const result = await readCurrent()
      lastPublishedFingerprint = JSON.stringify(result)
      ensureWatcher()
      return result
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    write(document) {
      const operation = writeChain.then(() => writeOne(document))
      writeChain = operation
      return operation
    },
    async stop() {
      if (stopped) return
      stopped = true
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      watcher?.close()
      watcher = null
      await writeChain
    },
  }
}

function decodeConnection(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): ConfiguredConnection | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  const integration = decodeIntegration(value.integration, `${path}.integration`, issues)
  exactKeys(
    value,
    integration === 'github'
      ? ['id', 'integration', 'name', 'builtIn', 'githubIdentity']
      : ['id', 'integration', 'name', 'builtIn'],
    path,
    issues,
  )
  const id = nonEmptyString(value.id, `${path}.id`, issues)
  const name = nonEmptyString(value.name, `${path}.name`, issues)
  const builtIn = boolean(value.builtIn, `${path}.builtIn`, issues)
  const githubIdentity =
    integration === 'github'
      ? decodeGitHubIdentity(value.githubIdentity, `${path}.githubIdentity`, issues)
      : null
  if (!id || !integration || !name || builtIn === null) return null
  if (integration === 'github' && !githubIdentity) return null
  return {
    id,
    integration,
    name,
    builtIn,
    ...(githubIdentity ? { githubIdentity } : {}),
  }
}

function decodeGitHubIdentity(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): GitHubConnectionIdentity | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  exactKeys(value, ['id', 'login'], path, issues)
  const id = nonEmptyString(value.id, `${path}.id`, issues)
  const login = nonEmptyString(value.login, `${path}.login`, issues)
  return id && login ? { id, login } : null
}

function decodeRegistration(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): ProjectRegistration | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  exactKeys(value, ['key', 'connectionId', 'locator', 'workspace', 'displayName'], path, issues)
  const key = decodeProjectKey(value.key, `${path}.key`, issues)
  const connectionId = nonEmptyString(value.connectionId, `${path}.connectionId`, issues)
  const locatorValue = asRecord(value.locator, `${path}.locator`, issues)
  const workspaceValue = asRecord(value.workspace, `${path}.workspace`, issues)
  const displayName = optionalString(value.displayName, `${path}.displayName`, issues)
  if (!key || !connectionId || !locatorValue || !workspaceValue) return null

  const integration = decodeIntegration(
    locatorValue.integration,
    `${path}.locator.integration`,
    issues,
  )
  let locator: ProjectRegistration['locator'] | null = null
  if (integration === 'github') {
    exactKeys(
      locatorValue,
      ['integration', 'repositoryId', 'nameWithOwner'],
      `${path}.locator`,
      issues,
    )
    const repositoryId = nonEmptyString(
      locatorValue.repositoryId,
      `${path}.locator.repositoryId`,
      issues,
    )
    const nameWithOwner = nonEmptyString(
      locatorValue.nameWithOwner,
      `${path}.locator.nameWithOwner`,
      issues,
    )
    if (repositoryId && nameWithOwner) locator = { integration, repositoryId, nameWithOwner }
  } else if (integration === 'local') {
    exactKeys(locatorValue, ['integration', 'path'], `${path}.locator`, issues)
    const locatorPath = nonEmptyString(locatorValue.path, `${path}.locator.path`, issues)
    if (locatorPath) locator = { integration, path: locatorPath }
  }

  exactKeys(workspaceValue, ['path', 'gitIdentity'], `${path}.workspace`, issues)
  const workspacePath = nonEmptyString(workspaceValue.path, `${path}.workspace.path`, issues)
  const gitIdentity = optionalString(
    workspaceValue.gitIdentity,
    `${path}.workspace.gitIdentity`,
    issues,
  )
  if (!locator || !workspacePath) return null
  return {
    key,
    connectionId,
    locator,
    workspace: { path: workspacePath, ...(gitIdentity ? { gitIdentity } : {}) },
    ...(displayName ? { displayName } : {}),
  }
}

function decodeProjectKey(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): ProjectKey | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  exactKeys(value, ['integration', 'id'], path, issues)
  const integration = decodeIntegration(value.integration, `${path}.integration`, issues)
  const id = nonEmptyString(value.id, `${path}.id`, issues)
  return integration && id ? { integration, id } : null
}

function decodeClassification(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): LegacyClassificationConfiguration | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  exactKeys(value, ['command', 'enabledProjects'], path, issues)
  const command =
    value.command === undefined
      ? undefined
      : decodeLegacyHarnessCommand(value.command, `${path}.command`, issues)
  const enabledProjects = decodeEnabledProjects(value.enabledProjects, path, issues)
  return { ...(command ? { command } : {}), enabledProjects }
}

function decodeAutomation(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): AutomationConfiguration | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  exactKeys(
    value,
    ['enabled', 'classificationCommand', 'wayfinderCommand', 'enabledProjects'],
    path,
    issues,
  )
  const enabled = boolean(value.enabled, `${path}.enabled`, issues)
  const classificationCommand =
    value.classificationCommand === undefined
      ? undefined
      : decodeHarnessCommand(
          value.classificationCommand,
          `${path}.classificationCommand`,
          issues,
          CLASSIFICATION_PROMPT_MARKERS,
        )
  const wayfinderCommand =
    value.wayfinderCommand === undefined
      ? undefined
      : decodeHarnessCommand(
          value.wayfinderCommand,
          `${path}.wayfinderCommand`,
          issues,
          WAYFINDER_PROMPT_MARKERS,
        )
  const enabledProjects = decodeEnabledProjects(value.enabledProjects, path, issues)
  if (enabled === null) return null
  return {
    enabled,
    ...(classificationCommand ? { classificationCommand } : {}),
    ...(wayfinderCommand ? { wayfinderCommand } : {}),
    enabledProjects,
  }
}

function decodeLegacyAutomation(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): LegacyAutomationConfiguration | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  exactKeys(
    value,
    ['enabled', 'classificationCommand', 'wayfinderCommand', 'enabledProjects'],
    path,
    issues,
  )
  const enabled = boolean(value.enabled, `${path}.enabled`, issues)
  const classificationCommand =
    value.classificationCommand === undefined
      ? undefined
      : decodeLegacyHarnessCommand(
          value.classificationCommand,
          `${path}.classificationCommand`,
          issues,
        )
  const wayfinderCommand =
    value.wayfinderCommand === undefined
      ? undefined
      : decodeLegacyHarnessCommand(value.wayfinderCommand, `${path}.wayfinderCommand`, issues)
  const enabledProjects = decodeEnabledProjects(value.enabledProjects, path, issues)
  if (enabled === null) return null
  return {
    enabled,
    ...(classificationCommand ? { classificationCommand } : {}),
    ...(wayfinderCommand ? { wayfinderCommand } : {}),
    enabledProjects,
  }
}

function decodeEnabledProjects(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): ProjectKey[] {
  return array(input, `${path}.enabledProjects`, issues).flatMap((candidate, index) => {
    const key = decodeProjectKey(candidate, `${path}.enabledProjects[${index}]`, issues)
    return key ? [key] : []
  })
}

function decodeHarnessCommand(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
  promptMarkers: readonly string[],
): HarnessCommand | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  exactKeys(value, ['command', 'args', 'promptDelivery', 'promptTemplate'], path, issues)
  const base = decodeHarnessCommandFields(value, path, issues)
  const promptTemplate = literalCommandString(
    value.promptTemplate,
    `${path}.promptTemplate`,
    issues,
    false,
  )
  if (promptTemplate !== null) {
    validatePromptTemplate(promptTemplate, path, issues, promptMarkers)
  }
  return base && promptTemplate ? { ...base, promptTemplate } : null
}

function decodeLegacyHarnessCommand(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): LegacyHarnessCommand | null {
  const value = asRecord(input, path, issues)
  if (!value) return null
  exactKeys(value, ['command', 'args', 'promptDelivery'], path, issues)
  return decodeHarnessCommandFields(value, path, issues)
}

function decodeHarnessCommandFields(
  value: Record<string, unknown>,
  path: string,
  issues: ConfigurationIssue[],
): LegacyHarnessCommand | null {
  const command = literalCommandString(value.command, `${path}.command`, issues, false)
  const args = array(value.args, `${path}.args`, issues).flatMap((arg, index) => {
    const decoded = literalCommandString(arg, `${path}.args[${index}]`, issues, true)
    return decoded === null ? [] : [decoded]
  })
  const promptDelivery =
    value.promptDelivery === 'argument' || value.promptDelivery === 'stdin'
      ? value.promptDelivery
      : null
  if (promptDelivery === null) {
    issue(issues, `${path}.promptDelivery`, 'Must be "argument" or "stdin".')
  } else {
    const markers = args.filter((arg) => arg === '{{roadmap.prompt}}').length
    if (promptDelivery === 'argument' && markers !== 1) {
      issue(
        issues,
        `${path}.args`,
        'Argument delivery requires exactly one prompt marker argument.',
      )
    }
    if (promptDelivery === 'stdin' && markers !== 0) {
      issue(issues, `${path}.args`, 'Stdin delivery forbids the prompt marker argument.')
    }
  }
  return command && promptDelivery ? { command, args, promptDelivery } : null
}

function validatePromptTemplate(
  promptTemplate: string,
  path: string,
  issues: ConfigurationIssue[],
  allowed: readonly string[],
): void {
  const markers = promptTemplate.match(/{{[^{}]+}}/g) ?? []
  for (const marker of new Set(markers)) {
    if (!allowed.includes(marker)) {
      issue(issues, `${path}.promptTemplate`, `Unknown template marker ${JSON.stringify(marker)}.`)
    }
  }
}

function literalCommandString(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
  allowEmpty: boolean,
): string | null {
  if (typeof input !== 'string' || (!allowEmpty && input.trim() === '')) {
    issue(issues, path, allowEmpty ? 'Must be a string.' : 'Must be a non-empty string.')
    return null
  }
  if (input.includes('\0')) {
    issue(issues, path, 'Must not contain NUL.')
    return null
  }
  return input
}

function validateSemantics(
  connections: readonly ConfiguredConnection[],
  projects: readonly ProjectRegistration[],
  enabledProjects: readonly ProjectKey[] | null,
  issues: ConfigurationIssue[],
  requireReservedLocal: boolean,
  enabledProjectsPath: string,
): void {
  validateConnections(connections, issues, requireReservedLocal)
  validateProjects(connections, projects, issues)
  if (enabledProjects) {
    validateEnabledProjects(projects, enabledProjects, issues, enabledProjectsPath)
  }
}

function validateEnabledProjects(
  projects: readonly ProjectRegistration[],
  enabledProjects: readonly ProjectKey[],
  issues: ConfigurationIssue[],
  path: string,
): void {
  const seen = new Set<string>()
  for (const [index, enabled] of enabledProjects.entries()) {
    const key = `${enabled.integration}:${enabled.id}`
    if (seen.has(key)) issue(issues, `${path}[${index}]`, 'Must be unique.')
    seen.add(key)
    if (!projects.some((project) => projectKeyEquals(project.key, enabled))) {
      issue(issues, `${path}[${index}]`, 'Must name a registered Project.')
    }
  }
}

function projectKeyEquals(left: ProjectKey, right: ProjectKey): boolean {
  return left.integration === right.integration && left.id === right.id
}

function validateConnections(
  connections: readonly ConfiguredConnection[],
  issues: ConfigurationIssue[],
  requireReservedLocal: boolean,
): void {
  const localConnections = connections.filter((connection) => connection.integration === 'local')
  if (requireReservedLocal && localConnections.length !== 1) {
    issue(issues, '$.connections', 'Must contain exactly one built-in Local Connection.')
  }
  if (requireReservedLocal && localConnections[0]?.id !== 'local') {
    issue(issues, '$.connections', 'The built-in Local Connection id must be "local".')
  }

  const connectionIds = new Set<string>()
  const githubUserIds = new Set<string>()
  for (const [index, connection] of connections.entries()) {
    validateConnection(connection, index, connectionIds, githubUserIds, issues)
  }
}

function validateConnection(
  connection: ConfiguredConnection,
  index: number,
  connectionIds: Set<string>,
  githubUserIds: Set<string>,
  issues: ConfigurationIssue[],
): void {
  if (connectionIds.has(connection.id)) {
    issue(issues, `$.connections[${index}].id`, 'Must be unique.')
  }
  connectionIds.add(connection.id)
  if (connection.integration === 'local' && !connection.builtIn) {
    issue(issues, `$.connections[${index}].builtIn`, 'The Local Connection must be built in.')
  }
  if (connection.integration === 'github' && connection.builtIn) {
    issue(issues, `$.connections[${index}].builtIn`, 'A GitHub Connection cannot be built in.')
  }
  const githubUserId = connection.githubIdentity?.id
  if (!githubUserId) return
  if (githubUserIds.has(githubUserId)) {
    issue(
      issues,
      `$.connections[${index}].githubIdentity.id`,
      'That GitHub user already has a Connection.',
    )
  }
  githubUserIds.add(githubUserId)
}

interface ProjectValidationContext {
  connections: readonly ConfiguredConnection[]
  projectKeys: Set<string>
  workspaces: Set<string>
  githubRepositoryIds: Set<string>
  issues: ConfigurationIssue[]
}

function validateProjects(
  connections: readonly ConfiguredConnection[],
  projects: readonly ProjectRegistration[],
  issues: ConfigurationIssue[],
): void {
  const context: ProjectValidationContext = {
    connections,
    projectKeys: new Set(),
    workspaces: new Set(),
    githubRepositoryIds: new Set(),
    issues,
  }
  for (const [index, project] of projects.entries()) validateProject(project, index, context)
}

function validateProject(
  project: ProjectRegistration,
  index: number,
  context: ProjectValidationContext,
): void {
  const { connections, projectKeys, workspaces, githubRepositoryIds, issues } = context
  const key = `${project.key.integration}:${project.key.id}`
  if (projectKeys.has(key)) issue(issues, `$.projects[${index}].key`, 'Must be unique.')
  projectKeys.add(key)

  const workspacePath = canonicalConfigurationPath(project.workspace.path)
  if (workspacePath === null) {
    issue(issues, `$.projects[${index}].workspace.path`, 'Must be a canonical absolute path.')
  } else if (workspaces.has(workspacePath)) {
    issue(issues, `$.projects[${index}].workspace.path`, 'Must be unique.')
  } else {
    workspaces.add(workspacePath)
  }

  validateLocator(project, index, githubRepositoryIds, issues)
  const connection = connections.find((candidate) => candidate.id === project.connectionId)
  if (!connection) {
    issue(issues, `$.projects[${index}].connectionId`, 'Must name an existing Connection.')
  } else if (
    connection.integration !== project.key.integration ||
    connection.integration !== project.locator.integration
  ) {
    issue(issues, `$.projects[${index}]`, 'Connection, Project key, and locator must agree.')
  }
}

function validateLocator(
  project: ProjectRegistration,
  index: number,
  githubRepositoryIds: Set<string>,
  issues: ConfigurationIssue[],
): void {
  if (project.locator.integration === 'local') {
    if (project.locator.path !== project.workspace.path) {
      issue(
        issues,
        `$.projects[${index}].locator.path`,
        'Local locator and Workspace must be the same canonical path.',
      )
    }
    return
  }
  if (githubRepositoryIds.has(project.locator.repositoryId)) {
    issue(
      issues,
      `$.projects[${index}].locator.repositoryId`,
      'That GitHub repository is already registered.',
    )
  }
  githubRepositoryIds.add(project.locator.repositoryId)
}

function canonicalConfigurationPath(path: string): string | null {
  if (!isAbsolute(path) || normalize(path) !== path) return null
  return process.platform === 'darwin' ? path.toLocaleLowerCase() : path
}

async function atomicWrite(path: string, raw: string): Promise<ConfigurationWrite> {
  const directory = dirname(path)
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  let file: Awaited<ReturnType<typeof open>> | null = null
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(raw, 'utf8')
    await file.sync()
    await file.close()
    file = null
    await rename(temporary, path)
    const directoryHandle = await open(directory, 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
    return { ok: true }
  } catch (error) {
    await file?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    return { ok: false, kind: 'persistence', message: safeMessage(error) }
  }
}

function serializeConfiguration(document: RoadmapConfiguration): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function rejectSecrets(input: unknown, path: string, issues: ConfigurationIssue[]): void {
  if (Array.isArray(input)) {
    input.forEach((value, index) => {
      rejectSecrets(value, `${path}[${index}]`, issues)
    })
    return
  }
  if (!isRecord(input)) return
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_SECRET_KEY.test(key)) issue(issues, `${path}.${key}`, 'Secrets are not allowed.')
    rejectSecrets(value, `${path}.${key}`, issues)
  }
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ConfigurationIssue[],
): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issue(issues, `${path}.${key}`, 'Unknown field.')
  }
}

function asRecord(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): Record<string, unknown> | null {
  if (isRecord(input)) return input
  issue(issues, path, 'Must be an object.')
  return null
}

function array(input: unknown, path: string, issues: ConfigurationIssue[]): unknown[] {
  if (Array.isArray(input)) return input
  issue(issues, path, 'Must be an array.')
  return []
}

function integer(input: unknown, path: string, issues: ConfigurationIssue[]): number | null {
  if (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0) return input
  issue(issues, path, 'Must be a non-negative integer.')
  return null
}

function boolean(input: unknown, path: string, issues: ConfigurationIssue[]): boolean | null {
  if (typeof input === 'boolean') return input
  issue(issues, path, 'Must be a boolean.')
  return null
}

function nonEmptyString(input: unknown, path: string, issues: ConfigurationIssue[]): string | null {
  if (typeof input === 'string' && input.trim() !== '') return input.trim()
  issue(issues, path, 'Must be a non-empty string.')
  return null
}

function optionalString(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): string | undefined {
  if (input === undefined) return undefined
  return nonEmptyString(input, path, issues) ?? undefined
}

function decodeIntegration(
  input: unknown,
  path: string,
  issues: ConfigurationIssue[],
): Integration | null {
  if (input === 'github' || input === 'local') return input
  issue(issues, path, 'Must be "github" or "local".')
  return null
}

function issue(issues: ConfigurationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function safeMessage(error: unknown): string {
  if (error instanceof SyntaxError) return error.message
  if (isRecord(error) && typeof error.code === 'string')
    return `Filesystem operation failed (${error.code}).`
  return 'Filesystem operation failed.'
}
