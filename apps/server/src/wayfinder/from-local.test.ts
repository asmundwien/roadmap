import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project, Ticket, WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { readLocalProject } from './from-local.ts'

const REAL_FIXTURE = '/Users/asmund.wien/source/hdir/platform/microsoft-risiko'

describe('readLocalProject', () => {
  it('parses the real fixture into one open map with the expected frontier and source context', async () => {
    const project = await readLocalProject({
      key: { integration: 'local', id: 'microsoft-risiko' },
      rootPath: REAL_FIXTURE,
      name: 'microsoft-risiko',
    })

    expect(project).toMatchObject({
      key: { integration: 'local', id: 'microsoft-risiko' },
      name: 'microsoft-risiko',
      warnings: [],
      closedMaps: [],
      sourcePath: REAL_FIXTURE,
    })
    expect(project.openMaps).toHaveLength(1)
    const map = onlyMap(project)
    expect(map).toMatchObject({
      project: { integration: 'local', id: 'microsoft-risiko' },
      id: '.wayfinder/map.md',
      title: 'Azure-strategy leadership deck as a scroll-through webapp',
      isOpen: true,
      ticketsComplete: true,
      warnings: [],
      progress: { total: 17, completed: 15 },
      sourcePath: join(REAL_FIXTURE, '.wayfinder/map.md'),
    })
    expect(map.closedAt).toBeUndefined()
    expect(map.updatedAt).toBe(await latestRelevantMtime(REAL_FIXTURE))
    expect(map.tickets).toHaveLength(17)
    expect(map.tickets.filter((ticket) => ticket.state === 'closed')).toHaveLength(15)
    expect(map.frontier.map((ticket) => ticket.id)).toEqual(['16'])
    expect(map.body.decisions[0]?.url).toBe('tickets/02-re-story-for-scroll.md')
    const ticket1 = byId(map, '1')
    expect(ticket1.assignees).toEqual([{ name: 'research-subagent (fired at charting)' }])

    const ticket2 = byId(map, '2')
    expect(ticket2.body).toContain('[docs/page-list.md](../../docs/page-list.md)')
    expect(ticket2.sourcePath).toBe(
      join(REAL_FIXTURE, '.wayfinder/tickets/02-re-story-for-scroll.md'),
    )

    const ticket15 = byId(map, '15')
    expect(ticket15.state).toBe('closed')
    expect(ticket15.createdAt).toBeUndefined()
    expect(ticket15.closedAt).toBeUndefined()

    const ticket16 = byId(map, '16')
    expect(ticket16.state).toBe('frontier')

    const ticket17 = byId(map, '17')
    expect(ticket17).toMatchObject({ state: 'blocked', isBlocked: true, blockersComplete: true })
    expect(ticket17.blockedBy).toEqual([
      {
        project: { integration: 'local', id: 'microsoft-risiko' },
        ticketId: '15',
        displayId: '15',
        title: 'Build page 8 — Reopen the strategic goal before further lock-in',
        state: 'closed',
      },
      {
        project: { integration: 'local', id: 'microsoft-risiko' },
        ticketId: '16',
        displayId: '16',
        title: 'Landing and orientation — does the deck need a title page?',
        state: 'open',
      },
    ])
  })

  it('omits only unsafe tickets and marks unknown blockers as still blocking', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'roadmap-local-wayfinder-'))

    try {
      const wayfinderPath = join(rootPath, '.wayfinder')
      const ticketsPath = join(wayfinderPath, 'tickets')
      await mkdir(ticketsPath, { recursive: true })

      await writeFile(
        join(wayfinderPath, 'map.md'),
        `---
title: Synthetic map
---

# Synthetic map

## Destination

Prove tolerant local parsing.
`,
      )
      await writeFile(
        join(ticketsPath, '01-good.md'),
        `---
id: 1
title: Keep me
labels: wayfinder:task
status: open
assignee: research-subagent
blocked-by: [2, 99]
---

# Keep me

Body with a [relative note](../notes.md).
`,
      )
      await writeFile(
        join(ticketsPath, '02-closed.md'),
        `---
id: 2
title: Done
labels: [wayfinder:task]
status: closed
assignee:
blocked-by: []
---

# Done
`,
      )
      await writeFile(
        join(ticketsPath, '03-unsafe.md'),
        `---
id: 3
title: Unsafe
labels: [wayfinder:task]
assignee:
blocked-by: []
---

# Unsafe
`,
      )

      const project = await readLocalProject({
        key: { integration: 'local', id: 'synthetic' },
        rootPath,
      })
      const map = onlyMap(project)

      expect(map.tickets.map((ticket) => ticket.id)).toEqual(['1', '2'])
      expect(map.ticketsComplete).toBe(false)
      expect(map.warnings).toContain(
        'Omitted .wayfinder/tickets/03-unsafe.md: missing or unparseable frontmatter status.',
      )

      const ticket1 = byId(map, '1')
      expect(ticket1.assignees).toEqual([{ name: 'research-subagent' }])
      expect(ticket1.body).toContain('[relative note](../notes.md)')
      expect(ticket1.sourcePath).toBe(join(rootPath, '.wayfinder/tickets/01-good.md'))
      expect(ticket1.blockersComplete).toBe(false)
      expect(ticket1.state).toBe('blocked')
      expect(ticket1.warnings).toContain(
        'Frontmatter labels drifted from a list to a scalar; parsed it as one item.',
      )
      expect(ticket1.warnings).toContain('Unknown blocker 99: no parsed ticket carries that id.')
      expect(ticket1.blockedBy).toEqual([
        {
          project: { integration: 'local', id: 'synthetic' },
          ticketId: '2',
          displayId: '2',
          title: 'Done',
          state: 'closed',
        },
        {
          project: { integration: 'local', id: 'synthetic' },
          ticketId: '99',
          displayId: '99',
          state: 'unknown',
        },
      ])
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})

function onlyMap(project: Pick<Project, 'openMaps'>): WayfinderMap {
  const map = project.openMaps[0]
  if (!map) throw new Error('Expected project to contain one open map.')
  return map
}

function byId(map: { tickets: Ticket[] }, id: string): Ticket {
  const ticket = map.tickets.find((candidate) => candidate.id === id)
  if (!ticket) throw new Error(`Expected map to contain ticket ${id}.`)
  return ticket
}

async function latestRelevantMtime(rootPath: string): Promise<number> {
  const mapPath = join(rootPath, '.wayfinder/map.md')
  const ticketsPath = join(rootPath, '.wayfinder/tickets')
  const ticketFiles = (await readdir(ticketsPath))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(ticketsPath, name))
  const stats = await Promise.all([mapPath, ...ticketFiles].map((path) => stat(path)))
  return stats.reduce((latest, entry) => Math.max(latest, entry.mtimeMs), 0)
}
