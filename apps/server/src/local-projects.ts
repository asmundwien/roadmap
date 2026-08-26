import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord } from './type-guards.ts'

export const LOCAL_PROJECTS_PATH = fileURLToPath(
  new URL('../../../local-projects.json', import.meta.url),
)

/** Legacy v1 Registry input. Runtime Adapters never read this file. */

export interface LocalProjectRegistration {
  id: string
  rootPath: string
  rootExists: boolean
  displayName?: string
}

export interface LocalProjectRegistry {
  registrations: LocalProjectRegistration[]
  warnings: string[]
}

/**
 * Reads the hand-edited local registry. Missing is empty, malformed is warned-and-empty, and every
 * entry is validated in isolation so one bad registration does not hide the rest.
 */
export async function readLocalProjectRegistry(
  path = LOCAL_PROJECTS_PATH,
): Promise<LocalProjectRegistry> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissing(error)) return { registrations: [], warnings: [] }
    return {
      registrations: [],
      warnings: [`Could not read ${label(path)}: ${messageOf(error)}.`],
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      registrations: [],
      warnings: [`Could not parse ${label(path)} as JSON: ${messageOf(error)}.`],
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      registrations: [],
      warnings: [`${label(path)} must contain a JSON array of registrations.`],
    }
  }

  return readRegistrations(parsed, path)
}

interface RegistrationReadContext {
  registryPath: string
  warnings: string[]
  firstByPath: Map<string, number>
  firstById: Map<string, number>
}

async function readRegistrations(
  entries: unknown[],
  registryPath: string,
): Promise<LocalProjectRegistry> {
  const context: RegistrationReadContext = {
    registryPath,
    warnings: [],
    firstByPath: new Map(),
    firstById: new Map(),
  }
  const registrations: LocalProjectRegistration[] = []
  for (const [index, entry] of entries.entries()) {
    const registration = await readRegistration(entry, index, context)
    if (registration) registrations.push(registration)
  }
  return { registrations, warnings: context.warnings }
}

async function readRegistration(
  entry: unknown,
  index: number,
  context: RegistrationReadContext,
): Promise<LocalProjectRegistration | null> {
  const { registryPath, warnings, firstByPath, firstById } = context
  const where = `${label(registryPath)}[${index}]`
  if (!isRecord(entry)) {
    warnings.push(`Ignored ${where}: expected an object registration.`)
    return null
  }

  const rawPath = readRequiredString(entry.path, 'path', where, warnings)
  const id = readRequiredString(entry.id, 'id', where, warnings)
  const displayName = readOptionalString(entry.displayName, 'displayName', where, warnings)
  if (!rawPath || !id) return null

  const normalizedPath = normalizeRegisteredPath(rawPath)
  if (!normalizedPath.ok) {
    warnings.push(`Ignored ${where}: ${normalizedPath.warning}`)
    return null
  }

  const firstPath = firstByPath.get(normalizedPath.value)
  if (firstPath !== undefined) {
    warnings.push(
      `Ignored ${where}: path ${JSON.stringify(normalizedPath.value)} duplicates ${label(registryPath)}[${firstPath}].`,
    )
    return null
  }

  const firstId = firstById.get(id)
  if (firstId !== undefined) {
    warnings.push(
      `Ignored ${where}: id ${JSON.stringify(id)} duplicates ${label(registryPath)}[${firstId}].`,
    )
    return null
  }

  const root = await inspectRegisteredRoot(normalizedPath.value)
  if (root.warning) warnings.push(root.warning)
  firstByPath.set(normalizedPath.value, index)
  firstById.set(id, index)
  return {
    id,
    rootPath: normalizedPath.value,
    rootExists: root.exists,
    ...(displayName ? { displayName } : {}),
  }
}

function normalizeRegisteredPath(
  raw: string,
): { ok: true; value: string } | { ok: false; warning: string } {
  const expanded = expandHome(raw)
  if (expanded === null) {
    return {
      ok: false,
      warning: `path ${JSON.stringify(raw)} uses unsupported home shorthand; use ~/... or an absolute path.`,
    }
  }
  if (!isAbsolute(expanded)) {
    return {
      ok: false,
      warning: `path ${JSON.stringify(raw)} is relative; use ~/... or an absolute path.`,
    }
  }
  return { ok: true, value: resolve(expanded) }
}

function expandHome(raw: string): string | null {
  if (raw === '~') return homedir()
  if (raw.startsWith('~/')) return resolve(homedir(), raw.slice(2))
  if (raw.startsWith('~')) return null
  return raw
}

function readRequiredString(
  value: unknown,
  field: string,
  where: string,
  warnings: string[],
): string | null {
  if (typeof value !== 'string') {
    warnings.push(`Ignored ${where}: ${field} must be a string.`)
    return null
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    warnings.push(`Ignored ${where}: ${field} must not be empty.`)
    return null
  }
  return trimmed
}

function readOptionalString(
  value: unknown,
  field: string,
  where: string,
  warnings: string[],
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    warnings.push(`${where}: ${field} must be a string when present; ignoring that field.`)
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    warnings.push(`${where}: ${field} must not be empty when present; ignoring that field.`)
    return undefined
  }
  return trimmed
}

function label(path: string): string {
  return path
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function inspectRegisteredRoot(
  path: string,
): Promise<{ exists: boolean; warning: string | null }> {
  try {
    await stat(path)
    return { exists: true, warning: null }
  } catch (error) {
    if (isMissing(error)) {
      return {
        exists: false,
        warning: `Registered path ${JSON.stringify(path)} does not exist right now; it stays registered and should surface as unreachable.`,
      }
    }
    return {
      exists: false,
      warning: `Could not access registered path ${JSON.stringify(path)}: ${messageOf(error)}. It stays registered and should surface as unreachable.`,
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
