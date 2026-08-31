import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project, Ticket, WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { readLocalProject } from './from-local.ts'

const RISIKO_FIXTURE = '/Users/asmund.wien/source/hdir/platform/microsoft-risiko'
const RISIKO_MAP = 'azure-strategy-leadership-deck'
const PIPELINES_FIXTURE = '/Users/asmund.wien/source/hdir/felleskomponenter/frontend-pipelines'
const PIPELINES_MAP = 'frontend-pipeline-versioning'

describe('readLocalProject', () => {
  it('parses the standardized Risiko fixture with stable source context', async () => {
    const project = await readLocalProject({
      key: { integration: 'local', id: 'microsoft-risiko' },
      rootPath: RISIKO_FIXTURE,
      name: 'microsoft-risiko',
    })

    expect(project).toMatchObject({
      key: { integration: 'local', id: 'microsoft-risiko' },
      name: 'microsoft-risiko',
      warnings: [],
      closedMaps: [],
      sourcePath: RISIKO_FIXTURE,
    })
    expect(project.openMaps).toHaveLength(1)
    const map = onlyMap(project)
    expect(map).toMatchObject({
      project: { integration: 'local', id: 'microsoft-risiko' },
      id: `.wayfinder/${RISIKO_MAP}/map.md`,
      title: 'Azure-strategy leadership deck as a scroll-through webapp',
      isOpen: true,
      ticketsComplete: true,
      warnings: [],
      sourcePath: join(RISIKO_FIXTURE, '.wayfinder', RISIKO_MAP, 'map.md'),
    })
    expect(map.closedAt).toBeUndefined()
    expect(map.updatedAt).toBe(await latestRelevantMtime(RISIKO_FIXTURE, RISIKO_MAP))
    expect(map.body.decisions[0]?.url).toBe('tickets/02-re-story-for-scroll.md')

    const ticket2 = byId(map, '2')
    expect(ticket2.body).toContain('[docs/page-list.md](../../../docs/page-list.md)')
    expect(ticket2.sourcePath).toBe(
      join(RISIKO_FIXTURE, '.wayfinder', RISIKO_MAP, 'tickets/02-re-story-for-scroll.md'),
    )

    const ticket15 = byId(map, '15')
    expect(ticket15.state).toBe('closed')
    expect(ticket15.createdAt).toBeUndefined()
    expect(ticket15.closedAt).toBeUndefined()
  })

  it('parses the standardized pipelines fixture without compatibility warnings', async () => {
    const project = await readLocalProject({
      key: { integration: 'local', id: 'frontend-pipelines' },
      rootPath: PIPELINES_FIXTURE,
      name: 'frontend-pipelines',
    })

    expect(project.warnings).toEqual([])
    expect(project.closedMaps).toEqual([])
    expect(project.openMaps).toHaveLength(1)
    const map = onlyMap(project)
    expect(map).toMatchObject({
      id: `.wayfinder/${PIPELINES_MAP}/map.md`,
      title: 'Enforce versioned frontend pipeline releases',
      isOpen: true,
      ticketsComplete: true,
      warnings: [],
      sourcePath: join(PIPELINES_FIXTURE, '.wayfinder', PIPELINES_MAP, 'map.md'),
    })
    expect(byId(map, '1').state).toBe('closed')
  })

  it('discovers multiple map directories and separates closed maps from live maps', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'roadmap-local-wayfinder-'))

    try {
      const maps: { id: string; status: 'open' | 'closed' }[] = [
        { id: 'active-map', status: 'open' },
        { id: 'finished-map', status: 'closed' },
      ]
      for (const map of maps) {
        const mapDirectory = join(rootPath, '.wayfinder', map.id)
        await mkdir(join(mapDirectory, 'tickets'), { recursive: true })
        await writeFile(
          join(mapDirectory, 'map.md'),
          `---
title: ${map.id}
labels: [wayfinder:map]
status: ${map.status}
---

# ${map.id}
`,
        )
      }

      const project = await readLocalProject({
        key: { integration: 'local', id: 'synthetic' },
        rootPath,
      })

      expect(project.warnings).toEqual([])
      expect(project.openMaps.map((map) => map.id)).toEqual(['.wayfinder/active-map/map.md'])
      expect(project.closedMaps.map((map) => map.id)).toEqual(['.wayfinder/finished-map/map.md'])
      expect(project.closedMaps[0]?.isOpen).toBe(false)
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })

  it('omits only unsafe tickets and marks unknown blockers as still blocking', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'roadmap-local-wayfinder-'))

    try {
      const wayfinderPath = join(rootPath, '.wayfinder')
      const mapDirectory = join(wayfinderPath, 'synthetic-map')
      const ticketsPath = join(mapDirectory, 'tickets')
      await mkdir(ticketsPath, { recursive: true })

      await writeFile(
        join(mapDirectory, 'map.md'),
        `---
title: Synthetic map
labels: [wayfinder:map]
status: open
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
        'Omitted .wayfinder/synthetic-map/tickets/03-unsafe.md: missing or unparseable frontmatter status.',
      )

      const ticket1 = byId(map, '1')
      expect(ticket1.assignees).toEqual([{ name: 'research-subagent' }])
      expect(ticket1.body).toContain('[relative note](../notes.md)')
      expect(ticket1.sourcePath).toBe(join(rootPath, '.wayfinder/synthetic-map/tickets/01-good.md'))
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

async function latestRelevantMtime(rootPath: string, mapId: string): Promise<number> {
  const mapDirectory = join(rootPath, '.wayfinder', mapId)
  const mapPath = join(mapDirectory, 'map.md')
  const ticketsPath = join(mapDirectory, 'tickets')
  const ticketFiles = (await readdir(ticketsPath))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(ticketsPath, name))
  const stats = await Promise.all([mapPath, ...ticketFiles].map((path) => stat(path)))
  return stats.reduce((latest, entry) => Math.max(latest, entry.mtimeMs), 0)
}
