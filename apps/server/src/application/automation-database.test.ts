import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AutomationDatabase,
  type AutomationEvent,
  appendAutomationDatabase,
  createAutomationDatabaseDocument,
  decodeAutomationDatabase,
  replayAutomationDatabase,
} from './automation-database.ts'

const roots: string[] = []
const target = {
  project: { integration: 'local' as const, id: 'project' },
  mapId: 'map',
  ticketId: 'ticket',
}
const opportunity = { id: 'opportunity', target }
const RECORDED_AT = '2026-08-29T00:00:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function identity(id: string, opportunityId = opportunity.id) {
  return { id, opportunityId, recordedAt: RECORDED_AT }
}

function started(
  id = 'classification-started',
): Extract<AutomationEvent, { type: 'classification-started' }> {
  return { ...identity(id), type: 'classification-started', admission: 'automatic' }
}

function completed(
  verdict: 'afk' | 'hitl' | 'unable' = 'afk',
): Extract<AutomationEvent, { type: 'classification-completed' }> {
  return {
    ...identity('classification-completed'),
    type: 'classification-completed',
    processResult: { status: 'exited', code: 0 },
    verdict: { value: verdict, reason: `${verdict} verdict` },
  }
}

function database(events: readonly AutomationEvent[]): AutomationDatabase {
  return { schemaVersion: 3, opportunities: [opportunity], events }
}

describe('Automation event database', () => {
  it('strictly decodes only schema version 3 and exact event variants', () => {
    const valid = database([started()])
    expect(decodeAutomationDatabase(valid)).toEqual(valid)

    for (const invalid of [
      { schemaVersion: 2, records: [] },
      { ...valid, extra: true },
      { ...valid, events: [{ ...started(), extra: true }] },
      { ...valid, events: [{ ...started(), recordedAt: 'yesterday' }] },
      { ...valid, events: [{ ...started(), admission: 'manual' }] },
    ]) {
      expect(() => decodeAutomationDatabase(invalid)).toThrow()
    }
  })

  it('replays sequence into evidence and retains causal acknowledgement metadata', () => {
    const unknown = {
      ...identity('unknown'),
      type: 'wayfinder-outcome-unknown' as const,
      reason: 'Roadmap restarted.',
    }
    const value = database([
      started(),
      completed(),
      { ...identity('launching'), type: 'wayfinder-launching', admission: 'override' },
      { ...identity('running'), type: 'wayfinder-running' },
      unknown,
      {
        ...identity('acknowledged'),
        type: 'wayfinder-outcome-unknown-acknowledged',
        unknownEventId: unknown.id,
      },
    ])

    const projection = replayAutomationDatabase(value)

    expect(projection.records[0]).toMatchObject({
      opportunity,
      classification: {
        status: 'completed',
        admission: 'automatic',
        verdict: { value: 'afk' },
      },
      wayfinder: {
        status: 'outcome-unknown',
        admission: 'override',
        eventId: unknown.id,
        acknowledged: true,
      },
    })
    expect(projection.evidence[0]?.wayfinder).toEqual({
      status: 'outcome-unknown',
      admission: 'override',
      reason: 'Roadmap restarted.',
    })
  })

  it('derives a queued Session from an AFK verdict without inventing public evidence', () => {
    const projection = replayAutomationDatabase(database([started(), completed()]))

    expect(projection.records[0]?.wayfinder).toEqual({ status: 'queued' })
    expect(projection.evidence[0]).not.toHaveProperty('wayfinder')
  })

  it.each([
    ['orphan event', { schemaVersion: 3, opportunities: [], events: [started()] }],
    [
      'duplicate target',
      {
        schemaVersion: 3,
        opportunities: [opportunity, { id: 'other-opportunity', target }],
        events: [started(), started('other-start')],
      },
    ],
    [
      'Wayfinder before AFK',
      database([
        started(),
        completed('hitl'),
        { ...identity('launching'), type: 'wayfinder-launching', admission: 'automatic' },
      ]),
    ],
    ['repeated terminal event', database([started(), completed(), completed()])],
    [
      'wrong acknowledgement reference',
      database([
        started(),
        completed(),
        { ...identity('launching'), type: 'wayfinder-launching', admission: 'automatic' },
        { ...identity('unknown'), type: 'wayfinder-outcome-unknown', reason: 'Unknown.' },
        {
          ...identity('acknowledged'),
          type: 'wayfinder-outcome-unknown-acknowledged',
          unknownEventId: 'different-event',
        },
      ]),
    ],
  ])('rejects the invalid %s history', (_name, invalid) => {
    expect(() => decodeAutomationDatabase(invalid)).toThrow()
  })

  it('appends durable facts atomically without replacing prior history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roadmap-automation-database-'))
    roots.push(root)
    const path = join(root, 'automation.json')
    const document = createAutomationDatabaseDocument(path)

    expect(await document.load()).toEqual({ schemaVersion: 3, opportunities: [], events: [] })
    await document.append({ opportunities: [opportunity], events: [started()] })
    await document.append({ events: [completed()] })

    const stored: unknown = JSON.parse(await readFile(path, 'utf8'))
    expect(stored).toEqual(database([started(), completed()]))
    expect(await createAutomationDatabaseDocument(path).load()).toEqual(stored)

    await expect(
      document.append({
        events: [{ ...identity('invalid-running'), type: 'wayfinder-running' }],
      }),
    ).rejects.toThrow('invalid at this point in history')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(stored)
  })

  it('keeps appends immutable in memory', () => {
    const original = database([started()])
    const appended = appendAutomationDatabase(original, { events: [completed()] })

    expect(original.events.map((event) => event.type)).toEqual(['classification-started'])
    expect(appended.events.map((event) => event.type)).toEqual([
      'classification-started',
      'classification-completed',
    ])
  })
})
