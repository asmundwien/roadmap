import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import type { LocalObservationInput } from '../observation/coordinator.ts'
import type {
  Completeness,
  ObservationAttempt,
  ObservationBatch,
  ReadSequenceAllocator,
  SourceFailure,
  SourceMapContent,
  SourceMapKey,
  SourceProjectKey,
  SourceProvenance,
  SourceScope,
  SourceTicketContent,
  SourceTicketKey,
} from '../observation/source.ts'
import { failedAttempt, observedAttempt } from '../observation/source.ts'
import { parseMapBody } from './map-body.ts'
import { ticketTypeEvidenceFromLabels } from './tickets.ts'

export interface LocalProjectReadOptions {
  readonly nextReadSequence: ReadSequenceAllocator
  readonly knownTickets?: readonly { readonly key: SourceTicketKey; readonly path: string }[]
  readonly now?: () => number
}

interface LocalReadContext extends Required<LocalProjectReadOptions> {
  readonly project: SourceProjectKey & { readonly integration: 'local' }
}

interface ParsedMarkdownFile {
  body: string
  frontmatter: Record<string, string>
  warnings: string[]
}

type ParsedTimestamp = { kind: 'missing' } | { kind: 'invalid' } | { kind: 'value'; value: number }

type FailedAttempt = Extract<ObservationAttempt, { kind: 'failed' }>
type MapAttempt = Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'map' } }>

interface ParsedLocalTicket {
  path: string
  raw: string
  body: string
  mtimeMs: number
  readSequence: number
  attemptedAt: number
  observedAt: number
  id: string | null
  title?: string
  status: 'open' | 'closed' | 'unknown'
  closedAt: ParsedTimestamp
  labels: string[]
  assignees: SourceTicketContent['assignees']
  blockedByIds: string[]
  blockersComplete: boolean
  warnings: string[]
}

type TicketRead = { kind: 'readable'; ticket: ParsedLocalTicket } | FailedAttempt

/** Reads admitted local source scopes without turning failed reads into empty content. */
export async function readLocalProject(
  input: LocalObservationInput,
  options: LocalProjectReadOptions,
): Promise<ObservationBatch> {
  const context: LocalReadContext = {
    nextReadSequence: options.nextReadSequence,
    knownTickets: options.knownTickets ?? [],
    now: options.now ?? Date.now,
    project: { integration: input.ref.integration, id: input.ref.projectId },
  }
  const attempts: ObservationAttempt[] = []
  const attemptedAt = context.now()
  const readSequence = context.nextReadSequence()
  const projectScope = { kind: 'project', project: context.project } satisfies SourceScope
  const rootProvenance = provenance(input.workspace.path, 'inspect-root')
  try {
    // Enumeration proves directory readability. A successful stat does not.
    await readdir(input.workspace.path, { withFileTypes: true })
  } catch (error) {
    return { attempts: [failed(projectScope, attemptedAt, readSequence, rootProvenance, error)] }
  }
  attempts.push(
    observedAttempt({
      kind: 'observed',
      scope: projectScope,
      readSequence,
      attemptedAt,
      observedAt: context.now(),
      provenance: rootProvenance,
      completeness: { kind: 'complete' },
      value: {
        key: context.project,
        name: basename(input.workspace.path),
        source: { integration: 'local', path: input.workspace.path },
        warnings: [],
      },
    }),
  )

  const wayfinderPath = join(input.workspace.path, '.wayfinder')
  const membershipScope = {
    kind: 'maps-membership',
    project: context.project,
  } satisfies SourceScope
  const enumerationAt = context.now()
  const enumerationReadSequence = context.nextReadSequence()
  let mapPaths: string[]
  try {
    const entries = await readdir(wayfinderPath, { withFileTypes: true })
    mapPaths = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(wayfinderPath, entry.name, 'map.md'))
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    attempts.push(
      failed(
        membershipScope,
        enumerationAt,
        enumerationReadSequence,
        provenance(wayfinderPath, 'enumerate'),
        error,
      ),
    )
    return { attempts }
  }
  attempts.push(
    observedAttempt({
      kind: 'observed',
      scope: membershipScope,
      readSequence: enumerationReadSequence,
      attemptedAt: enumerationAt,
      observedAt: context.now(),
      provenance: provenance(wayfinderPath, 'enumerate'),
      completeness: { kind: 'complete' },
      value: {
        members: mapPaths.map((path) => ({
          project: context.project,
          mapId: displayPath(input.workspace.path, path),
        })),
      },
    }),
  )
  const maps = await Promise.all(mapPaths.map((path) => readLocalMap(input, path, context)))
  attempts.push(...maps.flatMap((slice) => slice.attempts))
  return { attempts }
}

async function readLocalMap(
  input: LocalObservationInput,
  mapPath: string,
  context: LocalReadContext,
): Promise<ObservationBatch> {
  const mapKey: SourceMapKey = {
    project: context.project,
    mapId: displayPath(input.workspace.path, mapPath),
  }
  const mapRead = await readLocalMapContent(mapKey, mapPath, context)
  const mapWarnings = mapRead.kind === 'observed' ? [...mapRead.value.warnings] : []
  const ticketsPath = join(dirname(mapPath), 'tickets')
  const membershipScope = { kind: 'tickets-membership', map: mapKey } satisfies SourceScope
  const enumerationAt = context.now()
  const enumerationReadSequence = context.nextReadSequence()
  const attempts: ObservationAttempt[] = []
  let ticketPaths: string[] = []
  let membershipFailure: FailedAttempt | undefined
  try {
    const entries = await readdir(ticketsPath, { withFileTypes: true })
    ticketPaths = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(ticketsPath, entry.name))
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    membershipFailure = failed(
      membershipScope,
      enumerationAt,
      enumerationReadSequence,
      provenance(ticketsPath, 'enumerate'),
      error,
    )
    mapWarnings.push(
      `Cannot read tickets directory: ${displayPath(input.workspace.path, ticketsPath)}.`,
    )
    ticketPaths = context.knownTickets
      .filter(
        (ticket) =>
          ticket.key.map.mapId === mapKey.mapId &&
          ticket.key.map.project.integration === mapKey.project.integration &&
          ticket.key.map.project.id === mapKey.project.id,
      )
      .map((ticket) => ticket.path)
  }
  const results = await Promise.all(
    ticketPaths.map((path) => readLocalTicket(mapKey, path, context)),
  )
  const kept = new Map<string, ParsedLocalTicket>()
  const unidentifiedTickets: SourceMapContent['unidentifiedTickets'][number][] = []
  let membershipIncomplete = false
  let ticketsIncomplete = membershipFailure !== undefined
  let latestTicketMtime = 0
  for (const result of results) {
    if (result.kind === 'failed') {
      ticketsIncomplete = true
      membershipIncomplete = true
      attempts.push(result)
      mapWarnings.push(
        `Cannot read ticket file: ${displayPath(input.workspace.path, result.provenance.integration === 'local' ? result.provenance.path : ticketsPath)}.`,
      )
      continue
    }
    const ticket = result.ticket
    latestTicketMtime = Math.max(latestTicketMtime, ticket.mtimeMs)
    if (ticket.id === null || kept.has(ticket.id)) {
      membershipIncomplete = true
      ticketsIncomplete = true
      const warning =
        ticket.id === null
          ? 'Missing or unparseable frontmatter id.'
          : `Duplicate ticket id ${ticket.id}.`
      unidentifiedTickets.push({
        sourcePath: ticket.path,
        raw: ticket.raw,
        warnings: [...ticket.warnings, warning],
      })
      mapWarnings.push(`Unidentified ${displayPath(input.workspace.path, ticket.path)}: ${warning}`)
      continue
    }
    kept.set(ticket.id, ticket)
    if (ticket.warnings.length > 0 || ticket.status === 'unknown') ticketsIncomplete = true
  }

  const ticketAttempts = materializeTickets(mapKey, kept)
  attempts.push(...ticketAttempts)
  if (membershipFailure) attempts.push(membershipFailure)
  else
    attempts.unshift(
      observedAttempt({
        kind: 'observed',
        scope: membershipScope,
        readSequence: enumerationReadSequence,
        attemptedAt: enumerationAt,
        observedAt: context.now(),
        provenance: provenance(ticketsPath, 'enumerate'),
        completeness: membershipIncomplete
          ? { kind: 'incomplete', reason: 'unreadable' }
          : { kind: 'complete' },
        value: { members: [...kept.keys()].map((ticketId) => ({ map: mapKey, ticketId })) },
      }),
    )
  for (const attempt of ticketAttempts) observedAttempt(attempt)
  if (mapRead.kind === 'failed') return { attempts: [mapRead, ...attempts] }
  const incomplete =
    ticketsIncomplete ||
    mapRead.completeness.kind === 'incomplete' ||
    ticketAttempts.some((attempt) => attempt.completeness.kind === 'incomplete')
  const mapAttempt: MapAttempt = {
    ...mapRead,
    completeness: incomplete
      ? { kind: 'incomplete', reason: ticketsIncomplete ? 'unreadable' : 'malformed' }
      : { kind: 'complete' },
    value: {
      ...mapRead.value,
      updatedAt: Math.max(mapRead.value.updatedAt, latestTicketMtime),
      progress:
        membershipFailure ||
        membershipIncomplete ||
        [...kept.values()].some((ticket) => ticket.status === 'unknown')
          ? null
          : {
              total: kept.size,
              completed: [...kept.values()].filter((ticket) => ticket.status === 'closed').length,
            },
      unidentifiedTickets,
      warnings: mapWarnings,
    },
  }
  observedAttempt(mapAttempt)
  return { attempts: [mapAttempt, ...attempts] }
}

async function readLocalMapContent(
  key: SourceMapKey,
  path: string,
  context: LocalReadContext,
): Promise<MapAttempt | FailedAttempt> {
  const attemptedAt = context.now()
  const readSequence = context.nextReadSequence()
  let raw: string
  let mtimeMs: number
  try {
    const [text, fileStat] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    raw = text
    mtimeMs = fileStat.mtimeMs
  } catch (error) {
    return failed(
      { kind: 'map', map: key },
      attemptedAt,
      readSequence,
      provenance(path, 'read'),
      error,
    )
  }
  const parsed = parseMarkdownFile(raw)
  const warnings = [...parsed.warnings]
  const title = readTitle(parsed.frontmatter.title, parsed.body)
  if (!parsed.frontmatter.title && title)
    warnings.push(
      'Map title fell back to the markdown heading because frontmatter title is missing.',
    )
  if (!title) warnings.push('Map title is missing from both frontmatter and the markdown heading.')
  const labels = readListField(parsed.frontmatter.labels, 'labels', warnings)
  if (!labels.includes('wayfinder:map'))
    warnings.push('Map frontmatter is missing the wayfinder:map label.')
  const status = readStatus(parsed.frontmatter.status)
  if (status === 'unknown') warnings.push('Map frontmatter status is missing or unparseable.')
  const body = parseMapBody(parsed.body)
  return {
    kind: 'observed',
    scope: { kind: 'map', map: key },
    readSequence,
    attemptedAt,
    observedAt: context.now(),
    provenance: provenance(path, 'read'),
    completeness:
      warnings.length > 0 || body.missingSections.length > 0
        ? { kind: 'incomplete', reason: 'malformed' }
        : { kind: 'complete' },
    value: {
      key,
      title,
      source: { kind: 'file', path },
      status,
      updatedAt: mtimeMs,
      body,
      progress: null,
      unidentifiedTickets: [],
      warnings,
    },
  }
}

function materializeTickets(
  map: SourceMapKey,
  parsedTickets: Map<string, ParsedLocalTicket>,
): Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'ticket' } }>[] {
  return [...parsedTickets.entries()].map(([ticketId, parsed]) => {
    const key: SourceTicketKey = { map, ticketId }
    const warnings = [...parsed.warnings]
    let blockersComplete = parsed.blockersComplete && parsed.status !== 'unknown'
    const blockedBy: SourceTicketContent['blockedBy'][number][] = []
    for (const blockerId of parsed.blockedByIds) {
      const target = parsedTickets.get(blockerId)
      if (!target || target.status === 'unknown') {
        blockersComplete = false
        warnings.push(`Unknown blocker ${blockerId}: no readable ticket certifies its status.`)
      }
      blockedBy.push({
        reference: { kind: 'registered', project: map.project, ticketId: blockerId },
        displayId: blockerId,
        title: target?.title,
        state: target?.status ?? 'unknown',
        provenance: provenance(target?.path ?? parsed.path, 'read'),
      })
    }
    const completeness: Completeness =
      warnings.length > 0 || !blockersComplete
        ? { kind: 'incomplete', reason: 'malformed' }
        : { kind: 'complete' }
    return {
      kind: 'observed',
      scope: { kind: 'ticket', ticket: key },
      readSequence: parsed.readSequence,
      attemptedAt: parsed.attemptedAt,
      observedAt: parsed.observedAt,
      provenance: provenance(parsed.path, 'read'),
      completeness,
      value: {
        key,
        displayId: ticketId,
        title: parsed.title,
        source: { kind: 'file', path: parsed.path },
        body: parsed.body,
        typeEvidence: ticketTypeEvidenceFromLabels(parsed.labels),
        status: parsed.status,
        ...(parsed.closedAt.kind === 'value' && parsed.status === 'closed'
          ? { closedAt: parsed.closedAt.value }
          : {}),
        isClaimed: parsed.assignees.length > 0,
        assignees: parsed.assignees,
        blockedBy,
        blockersComplete,
        warnings,
      },
    }
  })
}

async function readLocalTicket(
  map: SourceMapKey,
  path: string,
  context: LocalReadContext,
): Promise<TicketRead> {
  const attemptedAt = context.now()
  const readSequence = context.nextReadSequence()
  let raw: string
  let mtimeMs: number
  try {
    const [text, fileStat] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    raw = text
    mtimeMs = fileStat.mtimeMs
  } catch (error) {
    const known = context.knownTickets.find(
      (ticket) =>
        ticket.path === path &&
        ticket.key.map.mapId === map.mapId &&
        ticket.key.map.project.integration === map.project.integration &&
        ticket.key.map.project.id === map.project.id,
    )
    const scope: SourceScope = known
      ? { kind: 'ticket', ticket: known.key }
      : { kind: 'tickets-membership', map }
    return failed(scope, attemptedAt, readSequence, provenance(path, 'read'), error)
  }
  const parsed = parseMarkdownFile(raw)
  const warnings = [...parsed.warnings]
  const title = readTitle(parsed.frontmatter.title, parsed.body)
  if (!parsed.frontmatter.title && title)
    warnings.push(
      'Ticket title fell back to the markdown heading because frontmatter title is missing.',
    )
  if (!title)
    warnings.push('Ticket title is missing from both frontmatter and the markdown heading.')
  const labels = readListField(parsed.frontmatter.labels, 'labels', warnings)
  const blockedByIds = readListField(parsed.frontmatter['blocked-by'], 'blocked-by', warnings)
  const status = readStatus(parsed.frontmatter.status)
  const closedAt = readTimestamp(parsed.frontmatter['closed-at'])
  if (status === 'unknown') warnings.push('Ticket frontmatter status is missing or unparseable.')
  if (status === 'closed' && closedAt.kind !== 'value')
    warnings.push(
      closedAt.kind === 'missing'
        ? 'Missing frontmatter closed-at.'
        : 'Unparseable frontmatter closed-at.',
    )
  if (status === 'open' && closedAt.kind !== 'missing')
    warnings.push('Frontmatter closed-at is forbidden while status is open.')
  const assignee = readScalar(parsed.frontmatter.assignee)
  return {
    kind: 'readable',
    ticket: {
      path,
      raw,
      body: parsed.body,
      mtimeMs,
      readSequence,
      attemptedAt,
      observedAt: context.now(),
      id: readId(parsed.frontmatter.id),
      title,
      status,
      closedAt,
      labels,
      assignees: assignee ? [{ name: assignee }] : [],
      blockedByIds,
      blockersComplete: !warnings.some((warning) => warning.startsWith('Frontmatter blocked-by ')),
      warnings,
    },
  }
}

function failed(
  scope: SourceScope,
  attemptedAt: number,
  readSequence: number,
  source: SourceProvenance,
  error: unknown,
): FailedAttempt {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  const failure: SourceFailure = {
    kind: 'filesystem',
    operation: source.integration === 'local' ? source.operation : 'read',
    code: code === 'ENOENT' || code === 'EACCES' ? code : 'other',
  }
  return failedAttempt({
    kind: 'failed',
    scope,
    attemptedAt,
    readSequence,
    provenance: source,
    failure,
  })
}

function provenance(
  path: string,
  operation: 'inspect-root' | 'enumerate' | 'read',
): SourceProvenance {
  return { integration: 'local', path, operation }
}

function parseMarkdownFile(raw: string): ParsedMarkdownFile {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/)
  if (!match)
    return {
      body: raw,
      frontmatter: {},
      warnings: raw.startsWith('---')
        ? ['Frontmatter is malformed; retained the raw Markdown.']
        : [],
    }
  const frontmatter: Record<string, string> = {}
  const warnings: string[] = []
  const duplicateFields = new Set<string>()
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const lineMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!lineMatch) {
      if (line.trim()) warnings.push('Frontmatter contains an unparseable field.')
      continue
    }
    const key = lineMatch[1]
    const value = lineMatch[2]
    if (key === undefined || value === undefined) continue
    if (Object.hasOwn(frontmatter, key) || duplicateFields.has(key)) {
      warnings.push(`Duplicate frontmatter field ${key}.`)
      duplicateFields.add(key)
      delete frontmatter[key]
    } else {
      frontmatter[key] = value
    }
  }
  return { body: match[2] ?? '', frontmatter, warnings }
}

function readTitle(frontmatterTitle: string | undefined, body: string): string | undefined {
  const title = readScalar(frontmatterTitle)
  if (title) return title
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || undefined
}

function readId(raw: string | undefined): string | null {
  const value = readScalar(raw)
  return value && !/[[\]{}]/.test(value) && !['null', '~'].includes(value.toLowerCase())
    ? value
    : null
}

function readStatus(raw: string | undefined): 'open' | 'closed' | 'unknown' {
  const value = readScalar(raw)?.toLowerCase()
  return value === 'open' || value === 'closed' ? value : 'unknown'
}

function readTimestamp(raw: string | undefined): ParsedTimestamp {
  const value = readScalar(raw)
  if (!value) return { kind: 'missing' }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value)
    return { kind: 'invalid' }
  return { kind: 'value', value: timestamp }
}

function readListField(raw: string | undefined, field: string, warnings: string[]): string[] {
  const value = raw?.trim()
  if (!value) return []
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner
      .split(',')
      .map((entry) => readScalar(entry))
      .filter((entry): entry is string => Boolean(entry))
  }
  const scalar = readScalar(value)
  if (!scalar) return []
  warnings.push(`Frontmatter ${field} drifted from a list to a scalar; parsed it as one item.`)
  return [scalar]
}

function readScalar(raw: string | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (!value) return null
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    return value.slice(1, -1)
  return value
}

function displayPath(rootPath: string, path: string): string {
  const relativePath = relative(rootPath, path)
  return relativePath === '' ? '.' : relativePath
}
