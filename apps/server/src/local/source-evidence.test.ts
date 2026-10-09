import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalObservationInput } from '../observation/coordinator.ts'
import type {
  ObservationAttempt,
  ObservationBatch,
  SourceContribution,
  SourceScope,
} from '../observation/source.ts'
import { createLocalProjectRegistration, refineLocalWorkspaceProof } from '../projects/registry.ts'
import { type LocalProjectReadOptions, readLocalProject } from '../wayfinder/from-local.ts'
import { createLocalObserver } from './observer.ts'

const failures = vi.hoisted(() => new Map<string, Error>())
const readCompletionTimes = vi.hoisted(() => new Map<string, number>())

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      const failure = failures.get(`enumerate:${String(args[0])}`)
      return failure ? Promise.reject(failure) : actual.readdir(...args)
    },
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      const path = String(args[0])
      const failure = failures.get(`read:${path}`)
      if (failure) return Promise.reject(failure)
      return actual.readFile(...args).then((value) => {
        const time = readCompletionTimes.get(path)
        if (time !== undefined) vi.setSystemTime(time)
        return value
      })
    },
  }
})

let rootPath: string
let admittedInput: LocalObservationInput
const project = { integration: 'local', id: 'registered-opaque-key' } as const
const map = { project, mapId: '.wayfinder/known-map/map.md' }
const NOW = Date.parse('2026-10-08T12:00:00.000Z')

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  rootPath = await mkdtemp(join(tmpdir(), 'roadmap-local-evidence-'))
  await mkdir(join(rootPath, '.wayfinder'))
  admittedInput = createInput()
})

afterEach(async () => {
  failures.clear()
  readCompletionTimes.clear()
  vi.useRealTimers()
  await rm(rootPath, { recursive: true, force: true })
})

function createInput(): LocalObservationInput {
  const proof = refineLocalWorkspaceProof({
    inspection: { integration: 'local', path: rootPath, readable: true, searchable: true },
  })
  if (!proof.ok) throw new Error(proof.error.message)
  const registration = createLocalProjectRegistration({
    ref: { integration: 'local', projectId: project.id },
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

function read() {
  return readLocalProject(admittedInput)
}

function fail(operation: 'enumerate' | 'read', path: string, code: string): void {
  failures.set(
    `${operation}:${path}`,
    Object.assign(new Error('secret arbitrary exception text'), { code }),
  )
}

async function writeMap(): Promise<string> {
  const directory = join(rootPath, '.wayfinder/known-map')
  await mkdir(join(directory, 'tickets'), { recursive: true })
  await writeFile(
    join(directory, 'map.md'),
    '---\ntitle: Known map\nlabels: [wayfinder:map]\nstatus: open\n---\n\n# Known map\n\nReadable prose must survive.\n',
  )
  return directory
}

function latest(slice: ObservationBatch | undefined, scope: SourceScope): ObservationAttempt {
  const attempt = slice?.attempts.findLast(
    (item) => JSON.stringify(item.scope) === JSON.stringify(scope),
  )
  if (!attempt) throw new Error('Expected named source scope.')
  return attempt
}

function readableMap(
  slice: ObservationBatch,
): Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'map' } }> {
  const attempt = slice.attempts.find(
    (item): item is Extract<ObservationAttempt, { kind: 'observed'; scope: { kind: 'map' } }> =>
      item.kind === 'observed' && item.scope.kind === 'map',
  )
  if (!attempt) throw new Error('Expected readable map.')
  return attempt
}

function trackedReader() {
  let pending: Promise<ObservationBatch> = Promise.resolve({ attempts: [] })
  return {
    read(input: LocalObservationInput, options: LocalProjectReadOptions) {
      pending = readLocalProject(input, options)
      return pending
    },
    async settle() {
      await pending
      await setImmediate()
    },
  }
}

describe('local source evidence', () => {
  it('distinguishes a failed admitted root from a failed .wayfinder directory', async () => {
    await rm(join(rootPath, '.wayfinder'), { recursive: true })
    const missingDirectory = await read()
    expect(latest(missingDirectory, { kind: 'project', project }).kind).toBe('observed')
    expect(latest(missingDirectory, { kind: 'maps-membership', project })).toMatchObject({
      kind: 'failed',
      failure: { kind: 'filesystem', operation: 'enumerate', code: 'ENOENT' },
    })
    await rm(rootPath, { recursive: true })
    const missingRoot = await read()
    expect(missingRoot.attempts).toEqual([
      expect.objectContaining({
        kind: 'failed',
        scope: { kind: 'project', project },
        failure: { kind: 'filesystem', operation: 'inspect-root', code: 'ENOENT' },
      }),
    ])
  })

  it.each([
    {
      location: 'root',
      operation: 'enumerate',
      sourceOperation: 'inspect-root',
      scope: { kind: 'project', project },
    },
    {
      location: 'maps',
      operation: 'enumerate',
      sourceOperation: 'enumerate',
      scope: { kind: 'maps-membership', project },
    },
    { location: 'map', operation: 'read', sourceOperation: 'read', scope: { kind: 'map', map } },
    {
      location: 'tickets',
      operation: 'enumerate',
      sourceOperation: 'enumerate',
      scope: { kind: 'tickets-membership', map },
    },
  ] satisfies readonly {
    location: string
    operation: 'enumerate' | 'read'
    sourceOperation: string
    scope: SourceScope
  }[])(
    'classifies $location ENOENT, EACCES and other failures without inventing absence or success time',
    async ({ location, operation, sourceOperation, scope }) => {
      const directory = await writeMap()
      const paths: Record<string, string> = {
        root: rootPath,
        maps: join(rootPath, '.wayfinder'),
        map: join(directory, 'map.md'),
        tickets: join(directory, 'tickets'),
      }
      const path = paths[location]
      if (!path) throw new Error('Missing test source path.')
      for (const [code, expected] of [
        ['ENOENT', 'ENOENT'],
        ['EACCES', 'EACCES'],
        ['EIO', 'other'],
      ]) {
        if (!code || !expected) throw new Error('Missing failure fixture.')
        fail(operation, path, code)
        const result = await read()
        expect(latest(result, scope)).toEqual({
          kind: 'failed',
          scope,
          attemptedAt: NOW,
          provenance: { integration: 'local', operation: sourceOperation, path },
          failure: { kind: 'filesystem', operation: sourceOperation, code: expected },
        })
        expect(JSON.stringify(result)).not.toContain('secret arbitrary exception text')
        if (location === 'tickets') {
          expect(readableMap(result)).toMatchObject({
            completeness: { kind: 'incomplete' },
            value: { body: { raw: expect.stringContaining('Readable prose must survive.') } },
          })
        }
      }
    },
  )

  it('observes complete-empty map and ticket membership after successful enumeration', async () => {
    expect(latest(await read(), { kind: 'maps-membership', project })).toMatchObject({
      kind: 'observed',
      completeness: { kind: 'complete' },
      observedAt: NOW,
      value: { members: [] },
    })
    await writeMap()
    expect(latest(await read(), { kind: 'tickets-membership', map })).toMatchObject({
      kind: 'observed',
      completeness: { kind: 'complete' },
      observedAt: NOW,
      value: { members: [] },
    })
  })

  it('commits a readable map and ticket when an unidentified sibling file fails', async () => {
    const directory = await writeMap()
    const ticketPath = join(directory, 'tickets/01-readable.md')
    const failedPath = join(directory, 'tickets/99-blocker.md')
    await writeFile(
      ticketPath,
      '---\nid: 1\ntitle: Readable ticket\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: [99]\n---\n\nReadable ticket prose survives a sibling failure.\n',
    )
    await writeFile(failedPath, '---\nid: 99\nstatus: open\n---\n\nBlocker prose.\n')
    fail('read', failedPath, 'EACCES')
    const result = await read()

    expect(readableMap(result)).toMatchObject({
      completeness: { kind: 'incomplete' },
      value: { body: { raw: expect.stringContaining('Readable prose must survive.') } },
    })
    expect(latest(result, { kind: 'ticket', ticket: { map, ticketId: '1' } })).toMatchObject({
      kind: 'observed',
      value: {
        body: expect.stringContaining('Readable ticket prose survives a sibling failure.'),
        blockersComplete: false,
        blockedBy: [
          expect.objectContaining({
            reference: { kind: 'registered', project, ticketId: '99' },
            state: 'unknown',
          }),
        ],
      },
    })
    expect(latest(result, { kind: 'tickets-membership', map })).toMatchObject({
      kind: 'failed',
      provenance: { integration: 'local', path: failedPath, operation: 'read' },
      failure: { kind: 'filesystem', operation: 'read', code: 'EACCES' },
    })
    expect(
      result.attempts.some(
        (attempt) => attempt.scope.kind === 'ticket' && attempt.scope.ticket.ticketId === '99',
      ),
    ).toBe(false)
  })

  it.each(['ENOENT', 'EACCES', 'EIO'])(
    'names a known ticket file %s failure without losing readable siblings',
    async (code) => {
      const directory = await writeMap()
      const ticketPath = join(directory, 'tickets/99-blocker.md')
      await writeFile(
        ticketPath,
        '---\nid: 99\ntitle: Blocker\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: []\n---\n\nKnown blocker prose.\n',
      )
      await writeFile(
        join(directory, 'tickets/01-readable.md'),
        '---\nid: 1\ntitle: Readable sibling\nlabels: [wayfinder:task]\nstatus: open\nblocked-by: [99]\n---\n\nIndependent sibling prose.\n',
      )
      const updates: SourceContribution[] = []
      const reader = trackedReader()
      const observer = createLocalObserver(admittedInput, {
        readProject: reader.read,
        reconcileMs: 10,
        pathExists: async () => false,
        logger: { info() {}, warn() {} },
      })
      try {
        observer.subscribe((contribution) => updates.push(contribution))
        await observer.observe()
        expect(latest(updates[0], { kind: 'ticket', ticket: { map, ticketId: '99' } }).kind).toBe(
          'observed',
        )
        fail('read', ticketPath, code)
        await vi.advanceTimersByTimeAsync(10)
        await reader.settle()
        expect(
          latest(updates.at(-1), { kind: 'ticket', ticket: { map, ticketId: '99' } }),
        ).toMatchObject({
          kind: 'failed',
          provenance: { integration: 'local', operation: 'read', path: ticketPath },
          failure: { kind: 'filesystem', operation: 'read', code: code === 'EIO' ? 'other' : code },
        })
        expect(latest(updates.at(-1), { kind: 'tickets-membership', map })).toMatchObject({
          kind: 'observed',
          completeness: { kind: 'incomplete' },
        })
        expect(latest(updates.at(-1), { kind: 'map', map })).toMatchObject({
          kind: 'observed',
          value: { body: { raw: expect.stringContaining('Readable prose must survive.') } },
        })
        expect(latest(updates.at(-1), { kind: 'map', map })).toMatchObject({
          value: { progress: null },
        })
        expect(
          latest(updates.at(-1), { kind: 'ticket', ticket: { map, ticketId: '1' } }),
        ).toMatchObject({
          kind: 'observed',
          observedAt: NOW + 10,
          value: {
            body: expect.stringContaining('Independent sibling prose.'),
            blockersComplete: false,
            blockedBy: [expect.objectContaining({ state: 'unknown' })],
          },
        })
      } finally {
        await observer.stop()
      }
    },
  )

  it('records attempted and successful read clocks separately from source mtime', async () => {
    const directory = await writeMap()
    const path = join(directory, 'map.md')
    await utimes(path, new Date('2020-01-01'), new Date('2020-01-01'))
    readCompletionTimes.set(path, NOW + 250)
    const result = await read()
    expect(readableMap(result)).toMatchObject({
      attemptedAt: NOW,
      observedAt: NOW + 250,
      value: { updatedAt: Date.parse('2020-01-01T00:00:00.000Z') },
    })
  })

  it.each(['enumerate', 'read'] as const)(
    'retains unaffected scopes when a known %s scope fails and replaces failed evidence on recovery',
    async (operation) => {
      const directory = await writeMap()
      const updates: SourceContribution[] = []
      const reader = trackedReader()
      const observer = createLocalObserver(admittedInput, {
        readProject: reader.read,
        reconcileMs: 10,
        pathExists: async () => false,
        logger: { info() {}, warn() {} },
      })
      const scope: SourceScope =
        operation === 'enumerate' ? { kind: 'maps-membership', project } : { kind: 'map', map }
      const path =
        operation === 'enumerate' ? join(rootPath, '.wayfinder') : join(directory, 'map.md')
      try {
        observer.subscribe((contribution) => updates.push(contribution))
        await observer.observe()
        const earlierTicketList = latest(updates[0], { kind: 'tickets-membership', map })
        const earlierMap = latest(updates[0], { kind: 'map', map })
        fail(operation, path, 'EACCES')
        await vi.advanceTimersByTimeAsync(10)
        await reader.settle()
        expect(latest(updates.at(-1), scope)).toMatchObject({ kind: 'failed' })
        const currentTicketList = latest(updates.at(-1), { kind: 'tickets-membership', map })
        if (operation === 'enumerate') expect(currentTicketList).toEqual(earlierTicketList)
        else {
          if (earlierTicketList.kind !== 'observed' || currentTicketList.kind !== 'observed')
            throw new Error('Expected independently readable membership.')
          expect(currentTicketList.value).toEqual(earlierTicketList.value)
          expect(currentTicketList.observedAt).toBeGreaterThan(earlierTicketList.observedAt)
          expect(latest(updates.at(-1), scope)).not.toHaveProperty('observedAt')
        }
        if (operation === 'enumerate')
          expect(latest(updates.at(-1), { kind: 'map', map })).toEqual(earlierMap)
        failures.clear()
        await vi.advanceTimersByTimeAsync(10)
        await reader.settle()
        expect(latest(updates.at(-1), scope)).toMatchObject({
          kind: 'observed',
          observedAt: NOW + 20,
        })
      } finally {
        await observer.stop()
      }
    },
  )
})
