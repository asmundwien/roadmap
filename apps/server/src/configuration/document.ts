import { randomUUID } from 'node:crypto'
import { type FSWatcher, watch } from 'node:fs'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { z } from 'zod'
import { CLASSIFICATION_RESULT_SCHEMA_MARKER } from '../application/classification-contract.ts'
import { type ConfigurationMigrationInput, migrateConfiguration } from '../application/migration.ts'
import { SESSION_REPORT_SCHEMA_MARKER } from '../application/session-report-contract.ts'
import type { ProjectConfiguration, ProjectConfigurationIntent } from '../projects/registry.ts'
import { isRecord } from '../type-guards.ts'

interface ConfigurationIssue {
  path: string
  message: string
}
export type ConfigurationRead =
  | {
      ok: true
      document: ProjectConfiguration
      notices?: string[]
      durability?: 'confirmed' | 'unconfirmed'
      message?: string
    }
  | { ok: false; issues: ConfigurationIssue[] }
export type ConfigurationWrite =
  | { ok: true; durability: 'confirmed' | 'unconfirmed'; message?: string }
  | { ok: false; kind: 'conflict' | 'persistence'; message: string }
export interface ConfigurationDocument {
  load(): Promise<ConfigurationRead>
  subscribe(listener: (result: ConfigurationRead) => void): () => void
  write(document: ProjectConfiguration): Promise<ConfigurationWrite>
  stop(): Promise<void>
}
export type ConfigurationDecode =
  | { ok: true; value: ProjectConfiguration }
  | { ok: false; issues: ConfigurationIssue[] }
const text = z.string().trim().min(1)
const path = text.refine(
  (value) => isAbsolute(value) && normalize(value) === value,
  'Must be a canonical absolute path.',
)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const integration = z.enum(['local', 'github'])
const key = z.strictObject({ integration, id: text })
const identity = z.strictObject({ id: text, login: text })
const localConnection = z.strictObject({
  id: text,
  integration: z.literal('local'),
  name: text,
  builtIn: z.literal(true),
})
const githubConnection = z.strictObject({
  id: text,
  integration: z.literal('github'),
  name: text,
  builtIn: z.literal(false),
  githubIdentity: identity,
})
const connection = z.discriminatedUnion('integration', [localConnection, githubConnection])
const localRef = z.strictObject({ integration: z.literal('local'), projectId: text })
const githubRef = z.strictObject({ integration: z.literal('github'), projectId: text })
const localWorkspace = z.strictObject({ path, gitIdentity: text.optional() })
const githubWorkspace = z.strictObject({ path })
const locator = z.strictObject({ repositoryId: text, nameWithOwner: text })
const persistedProjectRegistrationSchema = z.union([
  z.strictObject({
    ref: localRef,
    connectionId: text,
    displayName: text.optional(),
    workspace: localWorkspace,
  }),
  z.strictObject({
    ref: githubRef,
    connectionId: text,
    displayName: text.optional(),
    locator,
    workspace: githubWorkspace,
  }),
])
const legacyRegistration = z
  .strictObject({
    key,
    connectionId: text,
    displayName: text.optional(),
    locator: z.discriminatedUnion('integration', [
      z.strictObject({ integration: z.literal('local'), path: text }),
      z.strictObject({ integration: z.literal('github'), repositoryId: text, nameWithOwner: text }),
    ]),
    workspace: localWorkspace,
  })
  .superRefine((value, context) => {
    if (value.key.integration !== value.locator.integration)
      context.addIssue({
        code: 'custom',
        path: ['locator', 'integration'],
        message: 'Project key and locator must agree.',
      })
    if (value.locator.integration === 'local' && value.locator.path !== value.workspace.path)
      context.addIssue({
        code: 'custom',
        path: ['locator', 'path'],
        message: 'Local locator and Workspace must be the same canonical path.',
      })
  })
type LegacyPersistedProjectRegistration = z.output<typeof legacyRegistration>
const literal = z.string().refine((value) => !value.includes('\0'), 'Must not contain NUL.')
const commandFields = {
  command: literal.refine((value) => value.trim() !== '', 'Must be a non-empty string.'),
  args: z.array(literal),
  promptDelivery: z.enum(['argument', 'stdin']),
}
function refineDelivery(
  value: { args: string[]; promptDelivery: 'argument' | 'stdin' },
  context: z.RefinementCtx,
): void {
  const count = value.args.filter((arg) => arg === '{{roadmap.prompt}}').length
  if (value.promptDelivery === 'argument' && count !== 1)
    context.addIssue({
      code: 'custom',
      path: ['args'],
      message: 'Argument delivery requires exactly one prompt marker argument.',
    })
  if (value.promptDelivery === 'stdin' && count !== 0)
    context.addIssue({
      code: 'custom',
      path: ['args'],
      message: 'Stdin delivery forbids the prompt marker argument.',
    })
}
const legacyCommand = z.strictObject(commandFields).superRefine(refineDelivery)
function harnessCommand(markers: readonly string[]) {
  return z
    .strictObject({
      ...commandFields,
      promptTemplate: literal.refine((value) => value.trim() !== '', 'Must be a non-empty string.'),
    })
    .superRefine((value, context) => {
      refineDelivery(value, context)
      for (const marker of new Set(value.promptTemplate.match(/{{[^{}]+}}/g) ?? []))
        if (!markers.includes(marker))
          context.addIssue({
            code: 'custom',
            path: ['promptTemplate'],
            message: `Unknown template marker ${JSON.stringify(marker)}.`,
          })
    })
}
const classificationCommand = harnessCommand([
  '{{roadmap.map}}',
  '{{roadmap.ticket}}',
  CLASSIFICATION_RESULT_SCHEMA_MARKER,
])
const wayfinderCommand = harnessCommand([
  '{{roadmap.map}}',
  '{{roadmap.ticket}}',
  SESSION_REPORT_SCHEMA_MARKER,
])
const automation = z.strictObject({
  enabled: z.boolean(),
  classificationCommand: classificationCommand.optional(),
  wayfinderCommand: wayfinderCommand.optional(),
  enabledProjects: z.array(key),
})
const legacyAutomation = z.strictObject({
  enabled: z.boolean(),
  classificationCommand: legacyCommand.optional(),
  wayfinderCommand: legacyCommand.optional(),
  enabledProjects: z.array(key),
})
const base = {
  configurationVersion: integer,
  connections: z.array(connection),
  projects: z.array(legacyRegistration),
}
const v1 = z.strictObject({ ...base, schemaVersion: z.literal(1) })
const v2 = z.strictObject({ ...base, schemaVersion: z.literal(2) })
const v3 = z.strictObject({
  ...base,
  schemaVersion: z.literal(3),
  classification: z.strictObject({
    command: legacyCommand.optional(),
    enabledProjects: z.array(key),
  }),
})
const v4 = z.strictObject({ ...base, schemaVersion: z.literal(4), automation: legacyAutomation })
const v5 = z.strictObject({ ...base, schemaVersion: z.literal(5), automation })
const legacySchema = z
  .discriminatedUnion('schemaVersion', [v1, v2, v3, v4, v5])
  .superRefine((value, context) => {
    validateRelations(
      {
        connections: value.connections,
        projects: value.projects.map(legacyIntent),
        enabledProjects:
          'automation' in value
            ? value.automation.enabledProjects
            : 'classification' in value
              ? value.classification.enabledProjects
              : [],
        requireLocal: value.schemaVersion !== 1,
      },
      context,
    )
  })
const persistedConfigurationSchema = z
  .strictObject({
    schemaVersion: z.literal(6),
    configurationVersion: integer,
    connections: z.array(connection),
    projects: z.array(persistedProjectRegistrationSchema),
    automation,
  })
  .superRefine((value, context) => {
    validateRelations(
      { ...value, enabledProjects: value.automation.enabledProjects, requireLocal: true },
      context,
    )
  })
type PersistedConfiguration = z.output<typeof persistedConfigurationSchema>
function validateRelations(
  value: {
    connections: ProjectConfiguration['connections']
    projects: ProjectConfigurationIntent[]
    enabledProjects: ProjectConfiguration['automation']['enabledProjects']
    requireLocal: boolean
  },
  context: z.RefinementCtx,
): void {
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: 'custom', path, message })
  const local = value.connections.filter((item) => item.integration === 'local')
  if (value.requireLocal && (local.length !== 1 || local[0]?.id !== 'local'))
    issue(['connections'], 'Must contain exactly one built-in Local Connection with id "local".')
  const connectionIds = new Set<string>()
  const accounts = new Set<string>()
  for (const [index, item] of value.connections.entries()) {
    if (connectionIds.has(item.id)) issue(['connections', index, 'id'], 'Must be unique.')
    connectionIds.add(item.id)
    if (item.integration === 'github') {
      if (accounts.has(item.githubIdentity.id))
        issue(
          ['connections', index, 'githubIdentity', 'id'],
          'That GitHub user already has a Connection.',
        )
      accounts.add(item.githubIdentity.id)
    }
  }
  const refs = new Set<string>()
  const paths = new Set<string>()
  const repositories = new Set<string>()
  for (const [index, item] of value.projects.entries()) {
    const ref = `${item.ref.integration}:${item.ref.projectId}`
    if (refs.has(ref)) issue(['projects', index, 'ref'], 'Must be unique.')
    refs.add(ref)
    const workspace = pathKey(item.workspace.path)
    if (paths.has(workspace)) issue(['projects', index, 'workspace', 'path'], 'Must be unique.')
    paths.add(workspace)
    const resolved = value.connections.find((entry) => entry.id === item.connectionId)
    if (!resolved) issue(['projects', index, 'connectionId'], 'Must name an existing Connection.')
    else if (resolved.integration !== item.ref.integration)
      issue(['projects', index, 'connectionId'], 'Connection and Project Integration must agree.')
    if ('locator' in item) {
      if (repositories.has(item.locator.repositoryId))
        issue(
          ['projects', index, 'locator', 'repositoryId'],
          'That GitHub repository is already registered.',
        )
      repositories.add(item.locator.repositoryId)
    }
  }
  const enabled = new Set<string>()
  for (const [index, item] of value.enabledProjects.entries()) {
    const ref = `${item.integration}:${item.id}`
    if (enabled.has(ref)) issue(['automation', 'enabledProjects', index], 'Must be unique.')
    if (!refs.has(ref))
      issue(['automation', 'enabledProjects', index], 'Must name a registered Project.')
    enabled.add(ref)
  }
}
function legacyIntent(row: LegacyPersistedProjectRegistration): ProjectConfigurationIntent {
  const common = {
    connectionId: row.connectionId,
    ...(row.displayName ? { displayName: row.displayName } : {}),
  }
  if (row.locator.integration === 'github')
    return {
      ...common,
      ref: { integration: 'github', projectId: row.key.id },
      locator: { repositoryId: row.locator.repositoryId, nameWithOwner: row.locator.nameWithOwner },
      workspace: { path: row.workspace.path },
    }
  return {
    ...common,
    ref: { integration: 'local', projectId: row.key.id },
    workspace: { ...row.workspace },
  }
}
export function decodeConfigurationDocument(input: unknown): ConfigurationDecode {
  const issues: ConfigurationIssue[] = []
  rejectSecrets(input, '$', issues)
  const decoded = persistedConfigurationSchema.safeParse(
    knownFields(input, persistedConfigurationSchema, '$', issues),
  )
  if (!decoded.success) issues.push(...schemaIssues(decoded.error))
  return decoded.success && issues.length === 0
    ? { ok: true, value: decoded.data }
    : { ok: false, issues }
}
/** Runtime refinements and capabilities never cross the persisted document seam. */
function encodeConfigurationDocument(configuration: ProjectConfiguration): PersistedConfiguration {
  const secretIssues: ConfigurationIssue[] = []
  rejectSecrets(configuration, '$', secretIssues)
  if (secretIssues.length) throw new Error('Secrets are not allowed in configuration.')
  for (const key of Object.keys(configuration)) {
    if (key !== 'admissions' && !Object.hasOwn(persistedConfigurationSchema.shape, key))
      throw new Error(`Unknown configuration field ${JSON.stringify(key)}.`)
  }
  const rows = configuration.projects.map((intent) => {
    const common = {
      ref: { ...intent.ref },
      connectionId: intent.connectionId,
      ...(intent.displayName ? { displayName: intent.displayName } : {}),
    }
    if ('locator' in intent)
      return {
        ...common,
        locator: { ...intent.locator },
        workspace: { path: intent.workspace.path },
      }
    return {
      ...common,
      workspace: {
        path: intent.workspace.path,
        ...(intent.workspace.gitIdentity ? { gitIdentity: intent.workspace.gitIdentity } : {}),
      },
    }
  })
  const result = decodeConfigurationDocument({
    schemaVersion: 6,
    configurationVersion: configuration.configurationVersion,
    connections: configuration.connections,
    projects: rows,
    automation: configuration.automation,
  })
  if (!result.ok)
    throw new Error(result.issues.map((item) => `${item.path}: ${item.message}`).join('\n'))
  return result.value
}

export function createConfigurationDocument(
  filename: string,
  options: { debounceMs?: number; legacyLocalProjectsPath?: string } = {},
): ConfigurationDocument {
  const listeners = new Set<(result: ConfigurationRead) => void>()
  let watcher: FSWatcher | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let lastRaw: string | null | undefined
  let fingerprint = ''
  let committedDurability:
    | { raw: string; durability: 'confirmed' | 'unconfirmed'; message?: string }
    | undefined
  let lane: Promise<void> = Promise.resolve()
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = lane.then(operation)
    lane = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  async function readRaw(): Promise<string | null> {
    try {
      return await readFile(filename, 'utf8')
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }
  function publish(result: ConfigurationRead): void {
    const next = JSON.stringify(result)
    if (next === fingerprint) return
    fingerprint = next
    for (const listener of listeners) listener(result)
  }
  async function replace(raw: string, expected: string | null): Promise<ConfigurationWrite> {
    let disk: string | null
    try {
      disk = await readRaw()
    } catch (error) {
      return { ok: false, kind: 'persistence', message: safeMessage(error) }
    }
    if (disk !== expected)
      return {
        ok: false,
        kind: 'conflict',
        message: 'roadmap.config.json changed on disk; wait for it to be applied and retry.',
      }
    const result = await atomicWrite(filename, raw)
    if (result.ok) {
      lastRaw = raw
      committedDurability = {
        raw,
        durability: result.durability,
        ...(result.message ? { message: result.message } : {}),
      }
    }
    return result
  }
  async function readCurrent(): Promise<ConfigurationRead> {
    let raw: string | null
    try {
      raw = await readRaw()
    } catch (error) {
      return { ok: false, issues: [{ path: '$', message: safeMessage(error) }] }
    }
    let input: unknown
    try {
      input =
        raw === null
          ? { schemaVersion: 1, configurationVersion: 0, connections: [], projects: [] }
          : JSON.parse(raw)
    } catch {
      lastRaw = raw
      return { ok: false, issues: [{ path: '$', message: 'Invalid JSON.' }] }
    }
    if (
      isRecord(input) &&
      typeof input.schemaVersion === 'number' &&
      input.schemaVersion >= 1 &&
      input.schemaVersion <= 5
    ) {
      const secretIssues: ConfigurationIssue[] = []
      rejectSecrets(input, '$', secretIssues)
      const legacy = legacySchema.safeParse(knownFields(input, legacySchema, '$', secretIssues))
      if (!legacy.success || secretIssues.length) {
        lastRaw = raw
        return {
          ok: false,
          issues: [...secretIssues, ...(!legacy.success ? schemaIssues(legacy.error) : [])],
        }
      }
      const row = legacy.data
      const migrationInput: ConfigurationMigrationInput = {
        schemaVersion: row.schemaVersion,
        configurationVersion: row.configurationVersion,
        connections: row.connections,
        projects: row.projects.map(legacyIntent),
        ...('classification' in row ? { classification: row.classification } : {}),
        ...('automation' in row ? { automation: row.automation } : {}),
      }
      const migration = await migrateConfiguration(
        migrationInput,
        options.legacyLocalProjectsPath ?? join(dirname(filename), 'local-projects.json'),
      )
      const decoded = decodeConfigurationDocument(migration.document)
      if (!decoded.ok) {
        lastRaw = raw
        return decoded
      }
      const persisted = await replace(serialize(encodeConfigurationDocument(decoded.value)), raw)
      if (!persisted.ok) {
        lastRaw = raw
        return { ok: false, issues: [{ path: '$', message: persisted.message }] }
      }
      return {
        ok: true,
        document: decoded.value,
        durability: persisted.durability,
        ...(persisted.message ? { message: persisted.message } : {}),
        ...(migration.notices.length ? { notices: migration.notices } : {}),
      }
    }
    lastRaw = raw
    const decoded = decodeConfigurationDocument(input)
    return decoded.ok
      ? {
          ok: true,
          document: decoded.value,
          ...(committedDurability?.raw === raw
            ? {
                durability: committedDurability.durability,
                ...(committedDurability.message ? { message: committedDurability.message } : {}),
              }
            : {}),
        }
      : decoded
  }
  function ensureWatcher(): void {
    if (watcher || stopped) return
    watcher = watch(dirname(filename), (_event, changed) => {
      if (stopped || (changed !== null && changed.toString() !== basename(filename))) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (!stopped) void serial(async () => publish(await readCurrent()))
      }, options.debounceMs ?? 100)
    })
    watcher.on('error', (error) =>
      publish({ ok: false, issues: [{ path: '$', message: safeMessage(error) }] }),
    )
  }
  return {
    load() {
      return serial<ConfigurationRead>(async () => {
        const result = await readCurrent()
        fingerprint = JSON.stringify(result)
        ensureWatcher()
        return result
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    write(document) {
      return serial<ConfigurationWrite>(async () => {
        if (stopped) return { ok: false, kind: 'persistence', message: 'Configuration is stopped.' }
        let persisted: PersistedConfiguration
        try {
          persisted = encodeConfigurationDocument(document)
        } catch {
          return {
            ok: false,
            kind: 'persistence',
            message: 'Configuration is invalid and was not written.',
          }
        }
        let expected = lastRaw
        if (expected === undefined) {
          try {
            expected = await readRaw()
          } catch (error) {
            return { ok: false, kind: 'persistence', message: safeMessage(error) }
          }
        }
        const result = await replace(serialize(persisted), expected)
        if (result.ok)
          publish({
            ok: true,
            document: persisted,
            durability: result.durability,
            ...(result.message ? { message: result.message } : {}),
          })
        return result
      })
    },
    async stop() {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      watcher?.close()
      watcher = null
      await lane
    },
  }
}

async function atomicWrite(filename: string, raw: string): Promise<ConfigurationWrite> {
  const directory = dirname(filename)
  const temporary = join(directory, `.${basename(filename)}.${randomUUID()}.tmp`)
  let file: Awaited<ReturnType<typeof open>> | null = null
  let directoryHandle: Awaited<ReturnType<typeof open>> | null = null
  let replaced = false
  let confirmed = false
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(raw, 'utf8')
    await file.sync()
    await file.close()
    file = null
    await rename(temporary, filename)
    replaced = true
    directoryHandle = await open(directory, 'r')
    await directoryHandle.sync()
    confirmed = true
    await directoryHandle.close()
    directoryHandle = null
    return { ok: true, durability: 'confirmed' }
  } catch (error) {
    await file?.close().catch(() => undefined)
    await directoryHandle?.close().catch(() => undefined)
    if (!replaced) {
      await unlink(temporary).catch(() => undefined)
      return { ok: false, kind: 'persistence', message: safeMessage(error) }
    }
    if (confirmed) return { ok: true, durability: 'confirmed' }
    return {
      ok: true,
      durability: 'unconfirmed',
      message: 'Configuration was replaced, but filesystem durability could not be confirmed.',
    }
  }
}
function serialize(document: PersistedConfiguration): string {
  return `${JSON.stringify(document, null, 2)}\n`
}
function pathKey(value: string): string {
  return process.platform === 'darwin' ? value.toLocaleLowerCase() : value
}
function missing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}
function safeMessage(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string'
    ? `Filesystem operation failed (${error.code}).`
    : 'Filesystem operation failed.'
}
function schemaIssues(error: z.ZodError): ConfigurationIssue[] {
  return error.issues.map((item) => ({
    path: `$${item.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('')}`,
    message: item.message,
  }))
}
function rejectSecrets(input: unknown, at: string, issues: ConfigurationIssue[]): void {
  if (Array.isArray(input)) {
    input.forEach((value, index) => {
      rejectSecrets(value, `${at}[${index}]`, issues)
    })
    return
  }
  if (!isRecord(input)) return
  for (const [key, value] of Object.entries(input)) {
    if (/(?:token|secret|password|credential|private.?key)/i.test(key))
      issues.push({ path: `${at}.${key}`, message: 'Secrets are not allowed.' })
    rejectSecrets(value, `${at}.${key}`, issues)
  }
}

/** Collect unknown fields before parsing, so unrelated relational failures remain reportable. */
function knownFields(
  input: unknown,
  schema: z.ZodType,
  at: string,
  issues: ConfigurationIssue[],
): unknown {
  if (schema instanceof z.ZodOptional) {
    const inner = schema.unwrap()
    return input === undefined || !(inner instanceof z.ZodType)
      ? input
      : knownFields(input, inner, at, issues)
  }
  if (schema instanceof z.ZodArray && Array.isArray(input)) {
    const element = schema.element
    return element instanceof z.ZodType
      ? input.map((value, index) => knownFields(value, element, `${at}[${index}]`, issues))
      : input
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema.options.filter(
      (option): option is z.ZodType => option instanceof z.ZodType,
    )
    const selected = options.find((option) => matchesDiscriminant(input, option)) ?? options[0]
    return selected ? knownFields(input, selected, at, issues) : input
  }
  if (!(schema instanceof z.ZodObject) || !isRecord(input)) return input
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const field: unknown = schema.shape[key]
    if (!(field instanceof z.ZodType))
      issues.push({ path: `${at}.${key}`, message: 'Unknown field.' })
    else result[key] = knownFields(value, field, `${at}.${key}`, issues)
  }
  return result
}
function matchesDiscriminant(input: unknown, schema: z.ZodType): boolean {
  if (!(schema instanceof z.ZodObject) || !isRecord(input)) return false
  for (const key of ['schemaVersion', 'integration']) {
    const field: unknown = schema.shape[key]
    if (field instanceof z.ZodLiteral && field.safeParse(input[key]).success) return true
  }
  const ref: unknown = schema.shape.ref
  if (ref instanceof z.ZodObject && isRecord(input.ref)) {
    const field: unknown = ref.shape.integration
    return field instanceof z.ZodLiteral && field.safeParse(input.ref.integration).success
  }
  return false
}
