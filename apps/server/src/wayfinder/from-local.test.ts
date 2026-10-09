import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalObservationInput } from '../observation/coordinator.ts'
import type { ObservationAttempt, ObservationBatch } from '../observation/source.ts'
import { createLocalProjectRegistration, refineLocalWorkspaceProof } from '../projects/registry.ts'
import { readLocalProject } from './from-local.ts'

const fixtureRoots: string[] = []
const key = { integration: 'local', id: 'admitted-opaque-key' } as const

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('readLocalProject', () => {
  it('reads standardized files with opaque identity, relative links and source timestamps', async () => {
    const root = await createFixture(
      'azure-strategy',
      'Azure strategy',
      [
        { id: '2', body: '# Story\n\n[docs/page-list.md](../../../docs/page-list.md)\n' },
        { id: '15', body: '# Done\n', closedAt: '2026-08-19T10:11:18.000Z' },
      ],
      '## Decisions\n\n- [Story](tickets/02-ticket.md)\n',
    )
    const before = Date.now()
    const slice = await readLocalProject(input(root))
    const map = onlyMap(slice)

    expect(slice.attempts).toContainEqual(
      expect.objectContaining({
        kind: 'observed',
        scope: { kind: 'project', project: key },
        value: {
          key,
          name: basename(root),
          source: { integration: 'local', path: root },
          warnings: [],
        },
      }),
    )
    expect(map.value).toMatchObject({
      key: { project: key, mapId: '.wayfinder/azure-strategy/map.md' },
      title: 'Azure strategy',
      status: 'open',
      warnings: [],
      source: { kind: 'file', path: join(root, '.wayfinder/azure-strategy/map.md') },
      progress: { total: 2, completed: 1 },
      unidentifiedTickets: [],
    })
    expect(map.observedAt).toBeGreaterThanOrEqual(before)
    expect(map.observedAt).toBeLessThanOrEqual(Date.now())
    expect(map.value.updatedAt).toBe(await latestRelevantMtime(root, 'azure-strategy'))
    expect(map.value.body.decisions[0]?.url).toBe('tickets/02-ticket.md')
    expect(byId(slice, '2').value).toMatchObject({
      body: expect.stringContaining('[docs/page-list.md](../../../docs/page-list.md)'),
      source: { kind: 'file', path: join(root, '.wayfinder/azure-strategy/tickets/02-ticket.md') },
      status: 'open',
      blockersComplete: true,
    })
    expect(byId(slice, '15').value).toMatchObject({
      status: 'closed',
      closedAt: Date.parse('2026-08-19T10:11:18.000Z'),
    })
    expect(byId(slice, '15').value.createdAt).toBeUndefined()
  })

  it('observes all enumerated map identities without inferring status from their order', async () => {
    const root = await createFixture('active-map', 'Active', [])
    const finished = join(root, '.wayfinder/finished-map')
    await mkdir(join(finished, 'tickets'), { recursive: true })
    await writeFile(
      join(finished, 'map.md'),
      '---\ntitle: Finished\nlabels: [wayfinder:map]\nstatus: closed\n---\n\n# Finished\n',
    )
    const slice = await readLocalProject(input(root))
    const maps = slice.attempts.filter(
      (attempt): attempt is MapAttempt =>
        attempt.kind === 'observed' && attempt.scope.kind === 'map',
    )

    expect(maps.map((map) => [map.value.key.mapId, map.value.status])).toEqual([
      ['.wayfinder/active-map/map.md', 'open'],
      ['.wayfinder/finished-map/map.md', 'closed'],
    ])
    expect(slice.attempts).toContainEqual(
      expect.objectContaining({
        kind: 'observed',
        scope: { kind: 'maps-membership', project: key },
        completeness: { kind: 'complete' },
        value: {
          members: [
            { project: key, mapId: '.wayfinder/active-map/map.md' },
            { project: key, mapId: '.wayfinder/finished-map/map.md' },
          ],
        },
      }),
    )
  })

  it('retains identified tickets with incomplete status and closure metadata', async () => {
    const root = await createFixture('synthetic-map', 'Synthetic', [
      { id: '2', body: '# Done', closedAt: '2026-08-17T08:42:36.000Z' },
    ])
    const tickets = join(root, '.wayfinder/synthetic-map/tickets')
    await writeFile(
      join(tickets, '01-good.md'),
      '---\nid: 1\ntitle: Keep me\nlabels: wayfinder:task\nstatus: open\nassignee: research-subagent\nblocked-by: [2, 99]\n---\n\nBody with a [relative note](../notes.md).\n',
    )
    const incomplete = [
      { id: '3', fields: '', status: 'unknown' },
      { id: '4', fields: 'status: closed\n', status: 'closed' },
      { id: '5', fields: 'status: open\nclosed-at: 2026-08-17T08:42:36.000Z\n', status: 'open' },
      { id: '6', fields: 'status: closed\nclosed-at: 2026-08-17\n', status: 'closed' },
    ]
    for (const ticket of incomplete) {
      await writeFile(
        join(tickets, `${ticket.id}.md`),
        `---\nid: ${ticket.id}\ntitle: Incomplete ${ticket.id}\nlabels: [wayfinder:task]\n${ticket.fields}blocked-by: []\n---\n\nReadable prose ${ticket.id}.\n`,
      )
    }
    const slice = await readLocalProject(input(root))

    expect(onlyMap(slice).completeness.kind).toBe('incomplete')
    expect(onlyMap(slice).value.progress).toBeNull()
    for (const ticket of incomplete) {
      expect(byId(slice, ticket.id)).toMatchObject({
        kind: 'observed',
        completeness: { kind: 'incomplete' },
        value: {
          status: ticket.status,
          body: expect.stringContaining(`Readable prose ${ticket.id}.`),
        },
      })
    }
    expect(byId(slice, '1').value).toMatchObject({
      assignees: [{ name: 'research-subagent' }],
      blockersComplete: false,
      body: expect.stringContaining('[relative note](../notes.md)'),
      blockedBy: [
        {
          reference: { kind: 'registered', project: key, ticketId: '2' },
          displayId: '2',
          title: 'Ticket 2',
          state: 'closed',
          provenance: {
            integration: 'local',
            operation: 'read',
            path: join(tickets, '02-ticket.md'),
          },
        },
        {
          reference: { kind: 'registered', project: key, ticketId: '99' },
          displayId: '99',
          state: 'unknown',
          provenance: {
            integration: 'local',
            operation: 'read',
            path: join(tickets, '01-good.md'),
          },
        },
      ],
    })
    expect(byId(slice, '1').value.warnings).toContain(
      'Frontmatter labels drifted from a list to a scalar; parsed it as one item.',
    )
  })

  it('retains malformed map prose and readable unknown blockers', async () => {
    const root = await createFixture('incomplete-map', 'Incomplete map', [])
    const directory = join(root, '.wayfinder/incomplete-map')
    const rawMap =
      '---\ntitle: Unfinished header\n\n# Incomplete map\n\nRaw map prose remains readable.\n'
    await writeFile(join(directory, 'map.md'), rawMap)
    await writeFile(
      join(directory, 'tickets/01-readable.md'),
      '---\nid: 1\ntitle: Readable ticket\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: [99]\n---\n\nReadable ticket body.\n',
    )
    await writeFile(
      join(directory, 'tickets/99-incomplete.md'),
      '---\nid: 99\ntitle: Incomplete blocker\nlabels: [wayfinder:task]\nblocked-by: []\n---\n\nRaw incomplete blocker prose must survive.\n',
    )
    const slice = await readLocalProject(input(root))

    expect(onlyMap(slice).value.body.raw).toBe(rawMap)
    expect(onlyMap(slice).value.status).toBe('unknown')
    expect(onlyMap(slice).value.body.missingSections).toContain('Destination')
    expect(byId(slice, '1').value).toMatchObject({
      blockersComplete: false,
      blockedBy: [expect.objectContaining({ state: 'unknown' })],
    })
    expect(byId(slice, '99')).toMatchObject({
      completeness: { kind: 'incomplete' },
      value: {
        status: 'unknown',
        body: expect.stringContaining('Raw incomplete blocker prose must survive.'),
      },
    })
  })

  it('preserves unidentified and duplicate ticket files without fabricating or replacing identities', async () => {
    const root = await createFixture('identity-map', 'Identity map', [
      { id: '1', body: 'First identity prose.' },
    ])
    const tickets = join(root, '.wayfinder/identity-map/tickets')
    const missing = '---\ntitle: Missing identity\nstatus: open\n---\n\nUnidentified prose.\n'
    const duplicate = '---\nid: 1\ntitle: Duplicate\nstatus: open\n---\n\nDuplicate prose.\n'
    await writeFile(join(tickets, '02-no-id.md'), missing)
    await writeFile(join(tickets, '03-duplicate.md'), duplicate)
    const slice = await readLocalProject(input(root))

    expect(byId(slice, '1').value.body).toBe('First identity prose.')
    expect(onlyMap(slice).value.progress).toBeNull()
    expect(onlyMap(slice).value.unidentifiedTickets).toMatchObject([
      { sourcePath: join(tickets, '02-no-id.md'), raw: missing, warnings: expect.any(Array) },
      { sourcePath: join(tickets, '03-duplicate.md'), raw: duplicate, warnings: expect.any(Array) },
    ])
    expect(slice.attempts).toContainEqual(
      expect.objectContaining({
        kind: 'observed',
        scope: {
          kind: 'tickets-membership',
          map: { project: key, mapId: '.wayfinder/identity-map/map.md' },
        },
        completeness: { kind: 'incomplete', reason: 'unreadable' },
      }),
    )
  })
})

type MapAttempt = Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'map' } }>
type TicketAttempt = Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'ticket' } }>

function onlyMap(slice: ObservationBatch): MapAttempt {
  const map = slice.attempts.find(
    (attempt): attempt is MapAttempt => attempt.kind === 'observed' && attempt.scope.kind === 'map',
  )
  if (!map) throw new Error('Expected one readable map.')
  return map
}

function byId(slice: ObservationBatch, id: string): TicketAttempt {
  const ticket = slice.attempts.find(
    (attempt): attempt is TicketAttempt =>
      attempt.kind === 'observed' &&
      attempt.scope.kind === 'ticket' &&
      attempt.scope.ticket.ticketId === id,
  )
  if (!ticket) throw new Error(`Expected readable ticket ${id}.`)
  return ticket
}

function input(path: string): LocalObservationInput {
  const proof = refineLocalWorkspaceProof({
    inspection: { integration: 'local', path, readable: true, searchable: true },
  })
  if (!proof.ok) throw new Error(proof.error.message)
  const registration = createLocalProjectRegistration({
    ref: { integration: 'local', projectId: key.id },
    connection: { id: 'local', integration: 'local', name: 'Local', builtIn: true },
    workspace: proof.value,
  })
  if (!registration.ok) throw new Error(registration.error.message)
  return {
    integration: 'local',
    ref: registration.value.ref,
    workspace: registration.value.workspace,
  }
}

async function latestRelevantMtime(rootPath: string, mapId: string): Promise<number> {
  const directory = join(rootPath, '.wayfinder', mapId)
  const files = (await readdir(join(directory, 'tickets')))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(directory, 'tickets', name))
  const stats = await Promise.all([join(directory, 'map.md'), ...files].map((path) => stat(path)))
  return stats.reduce((latest, entry) => Math.max(latest, entry.mtimeMs), 0)
}

async function createFixture(
  mapId: string,
  title: string,
  tickets: { id: string; body: string; closedAt?: string }[],
  body = '',
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-local-source-'))
  fixtureRoots.push(root)
  const directory = join(root, '.wayfinder', mapId)
  await mkdir(join(directory, 'tickets'), { recursive: true })
  await writeFile(
    join(directory, 'map.md'),
    `---\ntitle: ${title}\nlabels: [wayfinder:map]\nstatus: open\n---\n\n# ${title}\n\n${body}`,
  )
  for (const ticket of tickets) {
    await writeFile(
      join(directory, 'tickets', `${ticket.id.padStart(2, '0')}-ticket.md`),
      `---\nid: ${ticket.id}\ntitle: Ticket ${ticket.id}\nlabels: [wayfinder:task]\nstatus: ${ticket.closedAt ? 'closed' : 'open'}\n${ticket.closedAt ? `closed-at: ${ticket.closedAt}\n` : ''}assignee:\nblocked-by: []\n---\n\n${ticket.body}`,
    )
  }
  return root
}
