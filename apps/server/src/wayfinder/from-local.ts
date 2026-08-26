import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type {
  Assignee,
  Blocker,
  Project,
  ProjectKey,
  Ticket,
  WayfinderMap,
} from '@roadmap/contracts'
import { parseMapBody } from './map-body.ts'
import { deriveTicketState, frontierOf, ticketTypeEvidenceFromLabels } from './tickets.ts'

export interface LocalProjectInput {
  key: ProjectKey
  rootPath: string
  name?: string
}

interface ParsedMarkdownFile {
  body: string
  frontmatter: Record<string, string>
}

interface ParsedLocalTicket {
  path: string
  displayPath: string
  body: string
  mtimeMs: number
  id: string | null
  title?: string
  status: 'open' | 'closed' | null
  labels: string[]
  assignees: Assignee[]
  blockedByIds: string[]
  blockersComplete: boolean
  warnings: string[]
}

/** Reads the canonical `.wayfinder/` tree off disk and turns it into one local project. */
export async function readLocalProject(input: LocalProjectInput): Promise<Project> {
  const name = input.name ?? basename(input.rootPath)
  const wayfinderPath = join(input.rootPath, '.wayfinder')
  const mapPath = join(wayfinderPath, 'map.md')
  const project: Project = {
    key: input.key,
    name,
    openMaps: [],
    closedMaps: [],
    warnings: [],
    sourcePath: input.rootPath,
  }

  let mapText = ''
  let mapMtimeMs = 0
  try {
    const [raw, fileStat] = await Promise.all([readFile(mapPath, 'utf8'), stat(mapPath)])
    mapText = raw
    mapMtimeMs = fileStat.mtimeMs
  } catch (error) {
    project.warnings.push(`Missing local map: ${displayPath(input.rootPath, mapPath)}.`)
    void error
    return project
  }

  const parsedMap = parseMarkdownFile(mapText)
  const { title: mapTitle, warnings: mapWarnings } = readMapHeading(parsedMap)

  const ticketsDir = join(wayfinderPath, 'tickets')
  let ticketPaths: string[] = []
  let ticketsComplete = true
  try {
    const entries = await readdir(ticketsDir, { withFileTypes: true })
    ticketPaths = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(ticketsDir, entry.name))
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    ticketsComplete = false
    mapWarnings.push(`Missing tickets directory: ${displayPath(input.rootPath, ticketsDir)}.`)
    void error
  }

  const parsedTickets = await Promise.all(
    ticketPaths.map((path) => readLocalTicket(input.rootPath, path)),
  )
  const latestTicketMtime = parsedTickets.reduce(
    (latest, ticket) => Math.max(latest, ticket.mtimeMs),
    0,
  )

  const kept = new Map<string, ParsedLocalTicket>()
  for (const ticket of parsedTickets) {
    const reasons: string[] = []
    if (ticket.id === null) reasons.push('missing or unparseable frontmatter id')
    if (!ticket.status) reasons.push('missing or unparseable frontmatter status')

    if (reasons.length > 0 || ticket.id === null) {
      ticketsComplete = false
      mapWarnings.push(`Omitted ${ticket.displayPath}: ${reasons.join(' and ')}.`)
      continue
    }

    const id = ticket.id
    if (kept.has(id)) {
      ticketsComplete = false
      mapWarnings.push(`Omitted ${ticket.displayPath}: duplicate ticket id ${id}.`)
      continue
    }

    kept.set(id, ticket)
  }

  const tickets = materializeTickets(input.key, kept)
  const map: WayfinderMap = {
    project: input.key,
    id: '.wayfinder/map.md',
    title: mapTitle,
    isOpen: true,
    updatedAt: Math.max(mapMtimeMs, latestTicketMtime),
    body: parseMapBody(parsedMap.body),
    tickets,
    frontier: frontierOf(tickets),
    progress: {
      total: tickets.length,
      completed: tickets.filter((ticket) => ticket.state === 'closed').length,
    },
    ticketsComplete,
    warnings: mapWarnings,
    sourcePath: mapPath,
  }

  project.openMaps.push(map)
  return project
}

function readMapHeading(parsedMap: ParsedMarkdownFile): {
  title: string | undefined
  warnings: string[]
} {
  const title = readTitle(parsedMap.frontmatter.title, parsedMap.body)
  const warnings: string[] = []
  if (!parsedMap.frontmatter.title && title) {
    warnings.push(
      'Map title fell back to the markdown heading because frontmatter title is missing.',
    )
  }
  if (!title) {
    warnings.push('Map title is missing from both frontmatter and the markdown heading.')
  }
  return { title, warnings }
}

function materializeTickets(
  project: ProjectKey,
  parsedTickets: Map<string, ParsedLocalTicket>,
): Ticket[] {
  const tickets = [...parsedTickets.entries()].map(([id, ticket]) => {
    const titleWarnings = [...ticket.warnings]
    if (!ticket.title) {
      titleWarnings.push('Ticket title is missing from both frontmatter and the markdown heading.')
    }

    const built: Ticket = {
      id,
      displayId: id,
      title: ticket.title,
      body: ticket.body,
      typeEvidence: ticketTypeEvidenceFromLabels(ticket.labels),
      state: 'frontier',
      isClaimed: ticket.assignees.length > 0,
      isBlocked: false,
      assignees: ticket.assignees,
      blockedBy: [],
      blockersComplete: ticket.blockersComplete,
      warnings: titleWarnings,
      sourcePath: ticket.path,
    }
    return built
  })
  const ticketsById = new Map(tickets.map((ticket) => [ticket.id, ticket]))

  for (const ticket of tickets) {
    const parsed = parsedTickets.get(ticket.id)
    if (!parsed) continue

    const blockedBy: Blocker[] = []
    let blockersComplete = parsed.blockersComplete
    const warnings = [...ticket.warnings]

    for (const blockerId of parsed.blockedByIds) {
      const target = ticketsById.get(blockerId)
      const targetParsed = parsedTickets.get(blockerId)
      if (!target || !targetParsed) {
        blockersComplete = false
        warnings.push(`Unknown blocker ${blockerId}: no parsed ticket carries that id.`)
        blockedBy.push({
          project,
          ticketId: blockerId,
          displayId: blockerId,
          state: 'unknown',
        })
        continue
      }

      blockedBy.push({
        project,
        ticketId: target.id,
        displayId: target.displayId,
        title: target.title,
        state: targetParsed.status === 'closed' ? 'closed' : 'open',
      })
    }

    const isOpen = parsed.status === 'open'
    const hasOpenBlockers = blockedBy.some((blocker) => blocker.state !== 'closed')
    ticket.blockedBy = blockedBy
    ticket.blockersComplete = blockersComplete
    ticket.warnings = warnings
    ticket.isClaimed = parsed.assignees.length > 0
    ticket.isBlocked = hasOpenBlockers
    ticket.state = deriveTicketState({ isOpen, isClaimed: ticket.isClaimed, hasOpenBlockers })
  }

  return tickets
}

async function readLocalTicket(rootPath: string, path: string): Promise<ParsedLocalTicket> {
  const [raw, fileStat] = await Promise.all([readFile(path, 'utf8'), stat(path)])
  const parsed = parseMarkdownFile(raw)
  const warnings: string[] = []
  const title = readTitle(parsed.frontmatter.title, parsed.body)
  if (!parsed.frontmatter.title && title) {
    warnings.push(
      'Ticket title fell back to the markdown heading because frontmatter title is missing.',
    )
  }

  const labels = readListField(parsed.frontmatter.labels, 'labels', warnings)
  const blockedByIds = readListField(parsed.frontmatter['blocked-by'], 'blocked-by', warnings)
  const status = readStatus(parsed.frontmatter.status)
  const assignee = readScalar(parsed.frontmatter.assignee)

  return {
    path,
    displayPath: displayPath(rootPath, path),
    body: parsed.body,
    mtimeMs: fileStat.mtimeMs,
    id: readId(parsed.frontmatter.id),
    title,
    status,
    labels,
    assignees: assignee ? [{ name: assignee }] : [],
    blockedByIds,
    blockersComplete: !warnings.some((warning) => warning.startsWith('Frontmatter blocked-by ')),
    warnings,
  }
}

function parseMarkdownFile(raw: string): ParsedMarkdownFile {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/)
  if (!match) return { body: raw, frontmatter: {} }

  const frontmatterBlock = match[1] ?? ''
  const body = match[2] ?? ''
  const frontmatter: Record<string, string> = {}
  for (const line of frontmatterBlock.split(/\r?\n/)) {
    const lineMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!lineMatch) continue
    const key = lineMatch[1]
    const value = lineMatch[2]
    if (key === undefined || value === undefined) continue
    frontmatter[key] = value
  }
  return { body, frontmatter }
}

function readTitle(frontmatterTitle: string | undefined, body: string): string | undefined {
  const title = readScalar(frontmatterTitle)
  if (title) return title

  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return heading ? heading : undefined
}

function readId(raw: string | undefined): string | null {
  const value = readScalar(raw)
  return value ? value : null
}

function readStatus(raw: string | undefined): 'open' | 'closed' | null {
  const value = readScalar(raw)?.toLowerCase()
  return value === 'open' || value === 'closed' ? value : null
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
  ) {
    return value.slice(1, -1)
  }
  return value
}

function displayPath(rootPath: string, path: string): string {
  const relativePath = relative(rootPath, path)
  return relativePath === '' ? '.' : relativePath
}
