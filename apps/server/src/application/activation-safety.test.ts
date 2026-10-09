import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { ApplicationState, AutomationTarget, CommandOutcome } from '@roadmap/contracts'
import { applicationStateCodec } from '@roadmap/contracts/codecs'
import { describe, expect, it, vi } from 'vitest'
import {
  type AutomationDatabase,
  type AutomationDatabaseDocument,
  type AutomationEvent,
  appendAutomationDatabase,
} from '../automation/database.ts'
import type {
  AutomationLaunch,
  AutomationLauncher,
  ClassificationProcessResult,
  WayfinderProcessResult,
} from '../automation/engine.ts'
import {
  type ConfigurationDocument,
  type ConfigurationRead,
  type ConfigurationWrite,
  createConfigurationDocument,
} from '../configuration/document.ts'
import { createGitHubProjectAdmission } from '../github/admission.ts'
import type { CredentialBundle, GitHubConnectionPort } from '../github/connections.ts'
import { createGitHubObserverPool } from '../github/observer.ts'
import { createLocalProjectAdmission } from '../local/admission.ts'
import { inspectLocalWorkspace } from '../local/workspace.ts'
import type { SourceObserver } from '../observation/source.ts'
import type { HarnessCommand, ProjectConfiguration } from '../projects/registry.ts'
import {
  controlledSourceFixture,
  createSourceFixtureOwner,
  type FixtureMap,
  type FixtureProject,
  type FixtureTicket,
  publicMapResource,
} from '../source-test-fixtures.ts'
import { createRoadmapApplication } from './application.ts'
import type { CredentialVault } from './credential-vault.ts'
import { createApplicationOperations } from './operations.ts'

const LOCAL = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
} satisfies ProjectConfiguration['connections'][number]
const COMMAND: HarnessCommand = {
  command: process.execPath,
  args: [],
  promptDelivery: 'stdin',
  promptTemplate: 'Map {{roadmap.map}} ticket {{roadmap.ticket}}',
}

function memoryConfiguration(initial: ProjectConfiguration) {
  let current = initial
  const listeners = new Set<(result: ConfigurationRead) => void>()
  const document: ConfigurationDocument = {
    async load() {
      return { ok: true, document: current }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async write(next) {
      current = next
      return { ok: true, durability: 'confirmed' }
    },
    async stop() {},
  }
  return {
    document,
    emit(next: ProjectConfiguration) {
      current = next
      for (const listener of listeners) listener({ ok: true, document: next })
    },
    invalidate() {
      for (const listener of listeners)
        listener({ ok: false, issues: [{ path: '$', message: 'Invalid manual configuration.' }] })
    },
  }
}

function localContent(id: string, path: string, withTicket = false): FixtureProject {
  const key = { integration: 'local', id } satisfies FixtureProject['key']
  const ticket: FixtureTicket = {
    id: '1',
    displayId: '1',
    title: 'Retain the current policy',
    body: 'Do not launch under a superseded policy.',
    typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
    state: 'frontier',
    isClaimed: false,
    isBlocked: false,
    assignees: [],
    blockedBy: [],
    blockersComplete: true,
    warnings: [],
    sourcePath: join(path, '.wayfinder/tickets/1.md'),
  }
  const map: FixtureMap = {
    project: key,
    id: '.wayfinder/map.md',
    title: 'Activation safety',
    isOpen: true,
    updatedAt: 1,
    body: {
      raw: '',
      destination: 'Commit the latest policy before admitting work.',
      notes: [],
      decisions: [],
      notYetSpecified: [],
      notYetSpecifiedNote: '',
      outOfScope: [],
      sections: [],
      missingSections: [],
    },
    tickets: [ticket],
    frontier: [ticket],
    progress: { total: 1, completed: 0 },
    ticketsComplete: true,
    warnings: [],
    sourcePath: join(path, '.wayfinder/map.md'),
  }
  return {
    key,
    name: id,
    sourcePath: path,
    openMaps: withTicket ? [map] : [],
    closedMaps: [],
    warnings: [],
  }
}

function queuedDatabase(target: AutomationTarget): AutomationDatabase {
  const identity = { opportunityId: 'queued-opportunity', recordedAt: '2026-10-01T00:00:00.000Z' }
  return {
    schemaVersion: 3,
    opportunities: [{ id: identity.opportunityId, target }],
    events: [
      {
        ...identity,
        id: 'classified-start',
        type: 'classification-started',
        admission: 'automatic',
      },
      {
        ...identity,
        id: 'classified-end',
        type: 'classification-completed',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'afk', reason: 'Agent-ready.' },
      },
    ],
  }
}

interface EffectInvocation {
  stage: 'classification' | 'wayfinder'
  request: AutomationLaunch
  state: ApplicationState
}

// The launcher is an external effect port. All admission, reservation and postappend checks are real.
function recordingLauncher(current: () => ApplicationState, effects: EffectInvocation[]) {
  const sessions: Array<ReturnType<typeof Promise.withResolvers<WayfinderProcessResult>>> = []
  const launcher: AutomationLauncher = {
    classify(request) {
      effects.push({ stage: 'classification', request, state: structuredClone(current()) })
      const completion = Promise.withResolvers<ClassificationProcessResult>()
      return {
        completed: completion.promise,
        async stop() {
          completion.resolve({ status: 'outcome-unknown', reason: 'Test process stopped.' })
        },
      }
    },
    async dispatch(request) {
      effects.push({ stage: 'wayfinder', request, state: structuredClone(current()) })
      const completion = Promise.withResolvers<WayfinderProcessResult>()
      sessions.push(completion)
      return { completed: completion.promise }
    },
  }
  return {
    launcher,
    settleSessions() {
      for (const session of sessions)
        session.resolve({
          status: 'finished',
          code: null,
          signal: 'SIGTERM',
          stdout: '',
          stdoutOversized: false,
        })
    },
  }
}

function harmlessHost() {
  return createApplicationOperations({
    async launch() {
      throw new Error('This schedule must not launch a host process.')
    },
  })
}

type HostAdmissionReceipt = 'invalid' | 'workspace' | 'stopping' | 'rename'
type HostOccupancyReceipt = 'add-alias-project' | 'move-other-workspace-to-alias'

async function hostAdmissionBoundarySchedule(
  receipt: HostAdmissionReceipt | HostOccupancyReceipt | 'workspace-unavailable' | 'host-failure',
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-host-admission-safety-')))
  const workspacePath = join(root, 'workspace')
  const replacementPath = join(root, 'replacement')
  const aliasPath = join(root, 'workspace-alias')
  const saved: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [LOCAL],
    projects: [
      {
        ref: { integration: 'local', projectId: 'host-target' },
        connectionId: 'local',
        workspace: { path: workspacePath },
      },
      ...(receipt === 'move-other-workspace-to-alias'
        ? [
            {
              ref: { integration: 'local', projectId: 'other-project' },
              connectionId: 'local',
              workspace: { path: replacementPath },
            } satisfies ProjectConfiguration['projects'][number],
          ]
        : []),
    ],
    automation: { enabled: false, enabledProjects: [] },
  }
  const configuration = memoryConfiguration(saved)
  const effects: Array<{ executable: string; args: readonly string[]; state: ApplicationState }> =
    []
  let atActivationBoundary: (() => void) | undefined
  let received = false
  let receivedState: ApplicationState | undefined
  const application = createRoadmapApplication({
    configuration: configuration.document,
    admissions: { local: createLocalProjectAdmission() },
    operations: createApplicationOperations({
      async launch(executable, args) {
        if (receipt === 'host-failure') throw new Error('Private host launcher detail.')
        effects.push({ executable, args, state: structuredClone(application.current()) })
      },
    }),
    observers: {
      local(input) {
        const content = localContent(input.ref.projectId, input.workspace.path)
        const read = createSourceFixtureOwner()
        return controlledSourceFixture(content.key, read([content], 1_000)).observer
      },
      github() {
        throw new Error('No GitHub source belongs to this schedule.')
      },
      reconcileGitHubTopology() {
        const receive = atActivationBoundary
        atActivationBoundary = undefined
        // The public observer port runs inside activation. Receipt follows the synchronous commit,
        // before the awaited Workspace proof can return to the real host operation.
        if (receive) queueMicrotask(receive)
      },
    },
    now: () => 1_000,
    serverEpoch: 'host-admission-boundary',
  })
  try {
    await Promise.all([workspacePath, replacementPath].map((path) => mkdir(path)))
    await symlink(workspacePath, aliasPath, 'dir')
    await application.start()
    const initial = structuredClone(application.current())
    atActivationBoundary = () => {
      received = true
      switch (receipt) {
        case 'invalid':
          configuration.invalidate()
          break
        case 'workspace':
          configuration.emit({
            ...saved,
            configurationVersion: 2,
            projects: saved.projects.map((intent) => ({
              ...intent,
              workspace: { path: replacementPath },
            })),
          })
          break
        case 'stopping':
          void application.stop()
          break
        case 'rename':
          configuration.emit({
            ...saved,
            configurationVersion: 2,
            projects: saved.projects.map((intent) => ({
              ...intent,
              displayName: 'Renamed presentation',
            })),
          })
          break
        case 'add-alias-project':
          configuration.emit({
            ...saved,
            configurationVersion: 2,
            projects: [
              ...saved.projects,
              {
                ref: { integration: 'local', projectId: 'other-project' },
                connectionId: 'local',
                workspace: { path: aliasPath },
              },
            ],
          })
          break
        case 'move-other-workspace-to-alias':
          configuration.emit({
            ...saved,
            configurationVersion: 2,
            projects: saved.projects.map((intent) =>
              intent.ref.projectId === 'other-project'
                ? { ...intent, workspace: { path: aliasPath } }
                : intent,
            ),
          })
          break
        case 'workspace-unavailable':
        case 'host-failure':
          break
      }
      receivedState = structuredClone(application.current())
    }
    if (receipt === 'workspace-unavailable') await rm(workspacePath, { recursive: true })
    const outcome = await application.execute({
      type: 'launch-action',
      actionId: 'open-workspace',
      project: { integration: 'local', id: 'host-target' },
      expectedConfigurationVersion: 1,
    })
    let collisionOutcome: typeof outcome | undefined
    if (receipt === 'add-alias-project' || receipt === 'move-other-workspace-to-alias') {
      await vi.waitFor(() => expect(application.current().configurationVersion).toBe(2))
      collisionOutcome = await application.execute({
        type: 'launch-action',
        actionId: 'open-workspace',
        project: { integration: 'local', id: 'host-target' },
        expectedConfigurationVersion: 2,
      })
    }
    return { received, receivedState, initial, outcome, collisionOutcome, effects, workspacePath }
  } finally {
    await application.stop()
    await rm(root, { recursive: true, force: true })
  }
}

async function queuedReversionSchedule(stage: 'classification' | 'wayfinder', holdAppend: boolean) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-activation-safety-')))
  const targetPath = join(root, 'target')
  const aPath = join(root, 'source-a')
  const bPath = join(root, 'source-b')
  const bGate = Promise.withResolvers<void>()
  const revertedGate = Promise.withResolvers<void>()
  const durableGate = Promise.withResolvers<void>()
  const appendEntered = Promise.withResolvers<void>()
  let bRequested = false
  let reversionRequested = false
  let aObservations = 0
  let reservationRequested = false
  const targetProject = localContent('target', targetPath, true)
  const target: AutomationTarget = {
    project: targetProject.key,
    mapId: '.wayfinder/map.md',
    ticketId: '1',
  }
  const a: ProjectConfiguration = {
    schemaVersion: 6,
    configurationVersion: 1,
    connections: [LOCAL],
    projects: [
      {
        ref: { integration: 'local', projectId: 'target' },
        connectionId: 'local',
        workspace: { path: targetPath },
      },
      {
        ref: { integration: 'local', projectId: 'changing-source' },
        connectionId: 'local',
        workspace: { path: aPath },
      },
    ],
    automation: {
      enabled: false,
      enabledProjects: [target.project],
      classificationCommand: COMMAND,
      wayfinderCommand: COMMAND,
    },
  }
  const b: ProjectConfiguration = {
    ...a,
    configurationVersion: 2,
    projects: a.projects.map((intent) =>
      intent.ref.projectId === 'changing-source'
        ? { ...intent, workspace: { path: bPath } }
        : intent,
    ),
    automation: { ...a.automation, enabled: true },
  }
  const reverted: ProjectConfiguration = { ...a, configurationVersion: 3 }
  const configuration = memoryConfiguration(a)
  let stored: AutomationDatabase =
    stage === 'wayfinder'
      ? queuedDatabase(target)
      : { schemaVersion: 3, opportunities: [], events: [] }
  const startType = stage === 'classification' ? 'classification-started' : 'wayfinder-launching'
  const writes: AutomationEvent[] = []
  const database: AutomationDatabaseDocument = {
    async load() {
      return stored
    },
    async append(batch) {
      if (batch.events.some((event) => event.type === startType)) {
        reservationRequested = true
        appendEntered.resolve()
        if (holdAppend) await durableGate.promise
      }
      stored = appendAutomationDatabase(stored, batch)
      writes.push(...batch.events)
      return { database: stored, durability: 'confirmed' }
    },
  }
  const states: ApplicationState[] = []
  const effects: EffectInvocation[] = []
  const launches = recordingLauncher(() => application.current(), effects)
  const application = createRoadmapApplication({
    configuration: configuration.document,
    admissions: { local: createLocalProjectAdmission() },
    operations: harmlessHost(),
    observers: {
      local(input) {
        let gate: Promise<void> | undefined
        if (input.workspace.path === bPath) {
          bRequested = true
          gate = bGate.promise
        } else if (input.workspace.path === aPath && ++aObservations > 1) {
          reversionRequested = true
          gate = revertedGate.promise
        }
        const content =
          input.ref.projectId === 'target'
            ? targetProject
            : localContent(input.ref.projectId, input.workspace.path)
        const read = createSourceFixtureOwner()
        return controlledSourceFixture(content.key, read([content], 1_000), { gate }).observer
      },
      github() {
        throw new Error('No GitHub source belongs to this schedule.')
      },
    },
    automation: { database, launcher: launches.launcher },
    now: () => 1_000,
    serverEpoch: 'queued-activation-safety',
  })
  application.subscribe((state) => states.push(structuredClone(state)))
  try {
    await Promise.all([targetPath, aPath, bPath].map((path) => mkdir(path)))
    await application.start()
    expect(application.current().configurationVersion).toBe(1)
    expect(application.current().automation.enabled).toBe(false)
    expect(effects).toEqual([])
    expect(application.current().automation.overrides).toContainEqual(
      expect.objectContaining({ target, [stage]: { status: 'eligible' } }),
    )

    configuration.emit(b)
    await vi.waitFor(() => expect(bRequested).toBe(true))
    if (holdAppend) {
      bGate.resolve()
      await vi.waitFor(() => expect(application.current().configurationVersion).toBe(2))
      await vi.waitFor(() =>
        expect(reservationRequested, `Expected ${startType} append to be entered.`).toBe(true),
      )
      await appendEntered.promise
      expect(reservationRequested).toBe(true)
      expect(writes.some((event) => event.type === startType)).toBe(false)
      expect(stored.events.some((event) => event.type === startType)).toBe(false)
      expect(effects).toEqual([])
      configuration.emit(reverted)
      await vi.waitFor(() => expect(reversionRequested).toBe(true))
      expect(application.current().configurationVersion).toBe(2)
      expect(application.current().automation.availability.status).toBe('unavailable')
    } else {
      configuration.emit(reverted)
      expect(application.current().configurationVersion).toBe(1)
      bGate.resolve()
      await vi.waitFor(() =>
        expect(reversionRequested || application.current().configurationVersion === 3).toBe(true),
      )
    }
    // A different source holds v3 pending; this target's source, Workspace, pointers and commands never change.
    const pending = structuredClone(application.current())
    expect([2, 3]).toContain(pending.configurationVersion)
    expect(pending.registrations.find((entry) => entry.key.id === 'target')?.workspace.path).toBe(
      targetPath,
    )
    if (holdAppend) {
      expect(writes.some((event) => event.type === startType)).toBe(false)
      durableGate.resolve()
      await vi.waitFor(() =>
        expect(stored.events.filter((event) => event.type === startType)).toHaveLength(1),
      )
      const failureType =
        stage === 'classification' ? 'classification-launch-failed' : 'wayfinder-launch-failed'
      await vi.waitFor(() =>
        expect(stored.events.some((event) => event.type === failureType)).toBe(true),
      )
      expect(stored.events.filter((event) => event.type === startType)).toHaveLength(1)
      expect(writes.filter((event) => event.type === startType)).toHaveLength(1)
      const reservation = stored.events.find((event) => event.type === startType)
      const nonlaunch = stored.events.filter((event) => event.type === failureType)
      expect(reservation).toBeDefined()
      expect(nonlaunch).toHaveLength(1)
      expect(nonlaunch[0]?.opportunityId).toBe(reservation?.opportunityId)
      expect(
        stored.opportunities.find((entry) => entry.id === reservation?.opportunityId)?.target,
      ).toEqual(target)
      expect(application.current().configurationVersion).toBe(2)
      await vi.waitFor(() =>
        expect(application.current().automation.evidence[0]).toMatchObject({
          target,
          [stage]: { status: 'launch-failed', admission: 'automatic' },
        }),
      )
      expect(application.current().configurationVersion).toBe(2)
      expect(application.current().automation.availability.status).toBe('unavailable')
      expect(effects).toEqual([])
    }
    await setImmediate()
    const afterAppend = structuredClone(application.current())
    const effectsWhilePending = [...effects]
    const writesAfterAppend = [...writes]
    revertedGate.resolve()
    await vi.waitFor(() => expect(application.current().configurationVersion).toBe(3))
    await setImmediate()

    expect(effectsWhilePending).toEqual([])
    expect(effects).toEqual([])
    if (afterAppend.configurationVersion === 2)
      expect(afterAppend.automation.availability.status).toBe('unavailable')
    expect(application.current().automation.enabled).toBe(false)
    if (!holdAppend)
      expect(
        states
          .filter((state) => state.configurationVersion === 2)
          .every((state) => state.automation.availability.status === 'unavailable'),
      ).toBe(true)
    if (!holdAppend) {
      expect(reservationRequested).toBe(false)
      expect(writes.some((event) => event.type === startType)).toBe(false)
    } else {
      // A durable reservation that raced the receipt must settle as known nonlaunch, not execute under B.
      const failureType =
        stage === 'classification' ? 'classification-launch-failed' : 'wayfinder-launch-failed'
      expect(writesAfterAppend.some((event) => event.type === startType)).toBe(true)
      expect(writesAfterAppend).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: failureType })]),
      )
      expect(afterAppend.automation.evidence[0]?.target).toEqual(target)
      expect(application.current().automation.evidence[0]).toMatchObject({
        target,
        [stage]: { status: 'launch-failed', admission: 'automatic' },
      })
    }
  } finally {
    bGate.resolve()
    revertedGate.resolve()
    durableGate.resolve()
    const stopping = application.stop()
    launches.settleSessions()
    await stopping
    await rm(root, { recursive: true, force: true })
  }
}

describe('RoadmapApplication queued activation safety', () => {
  it.each(['classification', 'wayfinder'] satisfies Array<'classification' | 'wayfinder'>)(
    'does not launch automatic %s under intermediate B/v2 after A/v3 disabled is queued before B commits',
    async (stage) => queuedReversionSchedule(stage, false),
  )

  it.each(['classification', 'wayfinder'] satisfies Array<'classification' | 'wayfinder'>)(
    'records known nonlaunch when A/v3 arrives while the durable %s reservation under committed B/v2 is held',
    async (stage) => queuedReversionSchedule(stage, true),
  )

  it.each([
    ['invalid', 'invalid manual configuration'],
    ['workspace', 'a queued Local Workspace and source change'],
    ['stopping', 'application stopping'],
  ] satisfies Array<[Exclude<HostAdmissionReceipt, 'rename'>, string]>)(
    'denies the host effect when %s arrives after Workspace proof activation starts (%s)',
    async (receipt, _description) => {
      const result = await hostAdmissionBoundarySchedule(receipt)

      expect(result.received).toBe(true)
      expect(result.receivedState?.configurationVersion).toBe(1)
      expect(result.effects).toEqual([])
      expect(result.outcome).toMatchObject({
        ok: false,
        error: { code: 'admission-failed', field: 'workspace.path' },
      })
      if (receipt === 'invalid') {
        expect(result.receivedState?.configuration.valid).toBe(false)
        expect(result.outcome.state.projects).toEqual(result.initial.projects)
      }
      if (receipt === 'workspace')
        expect(result.receivedState?.registrations[0]?.workspace.path).toBe(result.workspacePath)
    },
  )

  it.each(['add-alias-project', 'move-other-workspace-to-alias'] satisfies HostOccupancyReceipt[])(
    'denies the host effect when %s queues canonical occupancy during Workspace proof activation',
    async (receipt) => {
      const result = await hostAdmissionBoundarySchedule(receipt)

      expect(result.received).toBe(true)
      expect(result.receivedState?.configurationVersion).toBe(1)
      expect(result.receivedState?.configuration.valid).toBe(true)
      expect(result.effects).toEqual([])
      expect(result.outcome).toMatchObject({
        ok: false,
        error: { code: 'admission-failed', field: 'workspace.path' },
      })
      const initialTarget = result.initial.projects.find(
        (project) => project.key.id === 'host-target',
      )
      expect(initialTarget).toMatchObject({
        key: { integration: 'local', id: 'host-target' },
        workspace: { path: result.workspacePath },
        resource: { kind: 'current-readable' },
      })
      expect(
        result.outcome.state.projects.find((project) => project.key.id === 'host-target'),
      ).toMatchObject({
        key: { integration: 'local', id: 'host-target' },
        workspace: { path: result.workspacePath },
        resource: { kind: 'current-readable' },
      })
      expect(
        result.outcome.state.registrations.find((project) => project.key.id === 'host-target'),
      ).toMatchObject({
        key: { integration: 'local', id: 'host-target' },
        workspace: { path: result.workspacePath },
      })

      // Reprove both real directories after v2 commits. The decoded alias cannot grant a
      // second Local source identity, but its canonical root still occupies A's Workspace.
      expect(result.collisionOutcome).toMatchObject({
        ok: false,
        error: { code: 'admission-failed', field: 'workspace.path' },
        state: { configurationVersion: 2 },
      })
      expect(
        result.collisionOutcome?.state.projects.find(
          (project) => project.key.id === 'other-project',
        ),
      ).toMatchObject({
        key: { integration: 'local', id: 'other-project' },
        resource: {
          kind:
            receipt === 'move-other-workspace-to-alias' ? 'retained-unavailable' : 'never-observed',
        },
        maps: [],
      })
      expect(
        result.collisionOutcome?.state.projects.find((project) => project.key.id === 'host-target'),
      ).toMatchObject({
        key: { integration: 'local', id: 'host-target' },
        workspace: { path: result.workspacePath },
        managementWarnings: expect.arrayContaining([expect.any(String)]),
      })
    },
  )

  it('permits the current Workspace host effect when a neutral presentation rename arrives during proof activation', async () => {
    const result = await hostAdmissionBoundarySchedule('rename')

    expect(result.received).toBe(true)
    expect(result.receivedState?.configurationVersion).toBe(1)
    expect(result.effects).toEqual([
      {
        executable: '/usr/bin/open',
        args: ['-a', 'Visual Studio Code', result.workspacePath],
        state: result.outcome.state,
      },
    ])
    expect(result.outcome).toMatchObject({
      ok: true,
      result: { type: 'action-launched', actionId: 'open-workspace' },
    })
  })

  it('preserves configured Project facts and denies the host effect after its Workspace disappears', async () => {
    const result = await hostAdmissionBoundarySchedule('workspace-unavailable')

    expect(result.effects).toEqual([])
    expect(result.outcome).toMatchObject({
      ok: false,
      error: { code: 'admission-failed', field: 'workspace.path' },
    })
    expect(result.outcome.state.registrations).toEqual(result.initial.registrations)
    expect(result.outcome.state.projects[0]?.key).toEqual({
      integration: 'local',
      id: 'host-target',
    })
  })

  it('reports an honest safe host failure without a completed effect', async () => {
    const result = await hostAdmissionBoundarySchedule('host-failure')

    expect(result.effects).toEqual([])
    expect(result.outcome).toMatchObject({
      ok: false,
      error: { code: 'launch-failed', field: 'actionId' },
    })
    expect(result.outcome.state.registrations).toEqual(result.initial.registrations)
    expect(JSON.stringify(result.outcome)).not.toContain('Private host launcher detail.')
  })

  it('keeps the active old-account capability coherent while a rejected new-account candidate waits for another source baseline', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-account-activation-safety-')))
    const oldPath = join(root, 'local-old')
    const candidatePath = join(root, 'local-candidate')
    const githubPath = join(root, 'github-workspace')
    const candidateGate = Promise.withResolvers<void>()
    let candidateRequested = false
    let clock = 1_000
    let mapTitle = 'Old-account map content'
    const githubObservers: SourceObserver[] = []
    const credentials: CredentialBundle = {
      accessToken: 'private-valid-old-account-access',
      refreshToken: 'private-valid-old-account-refresh',
      accessTokenExpiresAt: 10_000_000,
      refreshTokenExpiresAt: 20_000_000,
    }
    const records = new Map([['github', credentials]])
    const vault: CredentialVault = {
      async read(id) {
        return records.get(id) ?? null
      },
      async write(id, value) {
        records.set(id, value)
      },
      async delete(id) {
        records.delete(id)
      },
      async cleanupOrphans(ids) {
        for (const id of records.keys()) if (!ids.has(id)) records.delete(id)
      },
    }
    const github: GitHubConnectionPort = {
      integration: {
        integration: 'github',
        name: 'GitHub',
        connectionKind: 'device-authorization',
        newInstallationUrl: 'https://github.com/apps/roadmap/installations/new',
        installationsUrl: 'https://github.com/settings/installations',
        authorizationsUrl: 'https://github.com/settings/connections/applications/test',
      },
      async identify(token) {
        if (token !== credentials.accessToken) throw new Error('Unexpected account credential.')
        return { id: '42', login: 'old-account' }
      },
      async refresh() {
        throw new Error('The active credential is not expired.')
      },
      async beginDeviceAuthorization() {
        throw new Error('This schedule does not authorize accounts.')
      },
      async pollDeviceAuthorization() {
        throw new Error('This schedule does not authorize accounts.')
      },
    }
    const saved: ProjectConfiguration = {
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [
        LOCAL,
        {
          id: 'github',
          integration: 'github',
          name: 'GitHub',
          builtIn: false,
          githubIdentity: { id: '42', login: 'old-account' },
        },
      ],
      projects: [
        {
          ref: { integration: 'github', projectId: 'remote' },
          connectionId: 'github',
          locator: { repositoryId: '84', nameWithOwner: 'owner/roadmap' },
          workspace: { path: githubPath },
        },
        {
          ref: { integration: 'local', projectId: 'local' },
          connectionId: 'local',
          workspace: { path: oldPath },
        },
      ],
      automation: { enabled: false, enabledProjects: [] },
    }
    const configuration = memoryConfiguration(saved)
    const pool = createGitHubObserverPool({
      now: () => clock,
      reconcileMs: 1_000_000,
      logger: { warn() {} },
    })
    const states: ApplicationState[] = []
    const providerReads: Array<{ path: string; token: string }> = []
    const application = createRoadmapApplication({
      configuration: configuration.document,
      credentialVault: vault,
      github,
      operations: harmlessHost(),
      admissions: {
        local: createLocalProjectAdmission(),
        github: createGitHubProjectAdmission({
          async inspectWorkspace(path) {
            return { path, remotes: [{ name: 'origin', nameWithOwner: 'owner/roadmap' }] }
          },
        }),
      },
      providerRead(accessToken) {
        async function authorize(path: string) {
          const token = await accessToken()
          if (token !== credentials.accessToken)
            throw new Error('Provider received an unexpected credential.')
          providerReads.push({ path, token })
        }
        return {
          async restGet(path) {
            await authorize(path)
            if (path === '/repositories/84' || path === '/repos/owner/roadmap')
              return { id: 84, full_name: 'owner/roadmap' }
            if (
              path ===
              '/repos/owner/roadmap/issues?state=all&labels=wayfinder%3Amap&per_page=100&page=1'
            )
              return [{ number: 108 }]
            throw new Error(`Unexpected provider path ${path}`)
          },
          async graphql(_query, variables) {
            await authorize('map-read')
            if (variables?.o0 !== 'owner' || variables.n0 !== 'roadmap' || variables.i0 !== 108)
              throw new Error('Provider map request must match the admitted repository.')
            return {
              data: {
                rateLimit: {
                  cost: 1,
                  remaining: 5000,
                  limit: 5000,
                  resetAt: '2027-01-01T00:00:00Z',
                },
                m0: {
                  databaseId: 84,
                  nameWithOwner: 'owner/roadmap',
                  issue: {
                    number: 108,
                    title: mapTitle,
                    url: 'https://github.com/owner/roadmap/issues/108',
                    state: 'OPEN',
                    updatedAt: '2026-10-01T00:00:00Z',
                    closedAt: null,
                    body: '## Destination\n\nKeep the active account coherent.\n',
                    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
                    subIssues: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
                  },
                },
              },
              errors: [],
            }
          },
        }
      },
      observers: {
        local(input) {
          if (input.workspace.path === candidatePath) candidateRequested = true
          const content = localContent(input.ref.projectId, input.workspace.path)
          const read = createSourceFixtureOwner()
          return controlledSourceFixture(content.key, read([content], clock), {
            gate: input.workspace.path === candidatePath ? candidateGate.promise : undefined,
          }).observer
        },
        github(input) {
          const observer = pool.create(input)
          githubObservers.push(observer)
          return observer
        },
        reconcileGitHubTopology: (inputs) => pool.reconcileTopology(inputs),
        stop: () => pool.stop(),
      },
      now: () => clock,
      serverEpoch: 'candidate-account-safety',
    })
    application.subscribe((state) => states.push(structuredClone(state)))
    try {
      await Promise.all([oldPath, candidatePath, githubPath].map((path) => mkdir(path)))
      await application.start()
      const initial = structuredClone(application.current())
      expect(initial.connections.find((entry) => entry.id === 'github')).toMatchObject({
        githubIdentity: { id: '42', login: 'old-account' },
        availability: { status: 'available' },
      })
      expect(initial.projects.find((entry) => entry.key.id === 'remote')).toMatchObject({
        maps: expect.arrayContaining([
          expect.objectContaining({
            resource: expect.objectContaining({
              kind: 'current-readable',
              observation: expect.objectContaining({
                value: expect.objectContaining({ title: 'Old-account map content' }),
              }),
            }),
          }),
        ]),
      })
      const observer = githubObservers[0]
      if (!observer) throw new Error('The initial valid GitHub source must own a real observer.')
      configuration.emit({
        ...saved,
        configurationVersion: 2,
        connections: saved.connections.map((entry) =>
          entry.integration === 'github'
            ? { ...entry, githubIdentity: { id: '99', login: 'new-account' } }
            : entry,
        ),
        projects: saved.projects.map((entry) =>
          entry.ref.integration === 'local'
            ? { ...entry, workspace: { path: candidatePath } }
            : entry,
        ),
      })
      await vi.waitFor(() => expect(candidateRequested).toBe(true))
      const pending = structuredClone(application.current())
      const beforeRefresh = providerReads.length
      clock = 2_000
      mapTitle = 'Active provider update while candidate waits'
      await observer.refresh()
      const updatedWhilePending = structuredClone(application.current())
      candidateGate.resolve()
      await vi.waitFor(() => expect(application.current().configurationVersion).toBe(2))
      const committed = structuredClone(application.current())

      expect(pending.configurationVersion).toBe(1)
      expect(pending.connections.find((entry) => entry.id === 'github')).toMatchObject({
        githubIdentity: { id: '42', login: 'old-account' },
        availability: { status: 'available', observedAt: 1_000 },
      })
      expect(pending.registrations).toEqual(initial.registrations)
      expect(pending.projects.find((entry) => entry.key.id === 'remote')).toEqual(
        initial.projects.find((entry) => entry.key.id === 'remote'),
      )
      expect(updatedWhilePending.configurationVersion).toBe(1)
      expect(updatedWhilePending.connections.find((entry) => entry.id === 'github')).toMatchObject({
        githubIdentity: { id: '42' },
        availability: { status: 'available', observedAt: 2_000 },
      })
      const updatedProject = updatedWhilePending.projects.find((entry) => entry.key.id === 'remote')
      expect(updatedProject?.resource).toMatchObject({
        kind: 'current-readable',
        observation: { observedAt: 2_000 },
      })
      if (!updatedProject) throw new Error('The active old-account Project must remain published.')
      expect(publicMapResource(updatedProject, '108')?.resource).toMatchObject({
        kind: 'current-readable',
        observation: {
          observedAt: 2_000,
          value: { title: 'Active provider update while candidate waits' },
        },
      })
      expect(providerReads.slice(beforeRefresh).map((entry) => entry.path)).toContain('map-read')
      expect(await vault.read('github')).toEqual(credentials)
      expect(
        states
          .filter((state) => state.configurationVersion === 1)
          .every(
            (state) =>
              state.connections.find((entry) => entry.id === 'github')?.availability.status ===
              'available',
          ),
      ).toBe(true)
      expect(committed.connections.find((entry) => entry.id === 'github')).toMatchObject({
        githubIdentity: { id: '99', login: 'new-account' },
        availability: { status: 'authorization-required' },
      })
      expect(committed.projects.find((entry) => entry.key.id === 'remote')?.resource.kind).toBe(
        'retained-unavailable',
      )
      expect(committed.configuration.valid).toBe(true)
      const publicStates = JSON.stringify(states)
      expect(publicStates).not.toContain(credentials.accessToken)
      expect(publicStates).not.toContain(credentials.refreshToken)
    } finally {
      candidateGate.resolve()
      await application.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['confirmed', 'unconfirmed', 'failed'] as const)(
    'drains an admitted configuration write with an honest %s disk outcome',
    async (completion) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-configuration-drain-')))
      const filename = join(root, 'roadmap.config.json')
      const saved: ProjectConfiguration = {
        schemaVersion: 6,
        configurationVersion: 1,
        connections: [LOCAL],
        projects: [],
        automation: { enabled: false, enabledProjects: [] },
      }
      await writeFile(filename, JSON.stringify(saved))
      const document = createConfigurationDocument(filename)
      const writeEntered = Promise.withResolvers<void>()
      const writeGate = Promise.withResolvers<void>()
      const writes: ProjectConfiguration[] = []
      const configuration: ConfigurationDocument = {
        ...document,
        async write(next): Promise<ConfigurationWrite> {
          writes.push(next)
          writeEntered.resolve()
          await writeGate.promise
          if (completion === 'failed')
            return { ok: false, kind: 'persistence', message: 'Harmless write failure.' }
          const persisted = await document.write(next)
          if (!persisted.ok || completion === 'confirmed') return persisted
          return {
            ok: true,
            durability: 'unconfirmed',
            message: 'Harmless directory sync uncertainty.',
          }
        },
      }
      const application = createRoadmapApplication({
        configuration,
        admissions: {},
        observers: {
          local() {
            throw new Error('The configuration drain has no Local sources.')
          },
          github() {
            throw new Error('The configuration drain has no GitHub sources.')
          },
        },
      })
      const states: ApplicationState[] = []
      application.subscribe((state) => states.push(structuredClone(state)))
      let writing: Promise<PromiseSettledResult<CommandOutcome>[]> | undefined
      let stopping: Promise<PromiseSettledResult<void>[]> | undefined
      try {
        await application.start()
        writing = Promise.allSettled([
          application.execute({
            type: 'rename-connection',
            connectionId: 'local',
            name: 'Saved during shutdown',
            expectedConfigurationVersion: 1,
          }),
        ])
        await writeEntered.promise
        let stopped = false
        stopping = Promise.allSettled([
          application.stop().then(() => {
            stopped = true
          }),
        ])
        const publicationsAtStop = states.length
        await setImmediate()
        expect(stopped).toBe(false)
        writeGate.resolve()
        const settled = (await writing)[0]
        expect(settled?.status).toBe('fulfilled')
        if (settled?.status !== 'fulfilled')
          throw new Error('An admitted write must return its persistence outcome.')
        expect(settled.value).toMatchObject(
          completion === 'confirmed'
            ? { ok: true, result: { type: 'configuration-updated', configurationVersion: 2 } }
            : { ok: false, error: { code: 'persistence-failed' } },
        )
        expect(settled.value.state).toMatchObject({
          configurationVersion: completion === 'failed' ? 1 : 2,
          connections: [
            { id: 'local', name: completion === 'failed' ? 'Local' : 'Saved during shutdown' },
          ],
        })
        expect(await stopping).toEqual([{ status: 'fulfilled', value: undefined }])
        expect(JSON.parse(await readFile(filename, 'utf8'))).toMatchObject({
          configurationVersion: completion === 'failed' ? 1 : 2,
          connections: [
            { id: 'local', name: completion === 'failed' ? 'Local' : 'Saved during shutdown' },
          ],
        })
        expect(application.current()).toMatchObject({
          configurationVersion: completion === 'failed' ? 1 : 2,
          connections: [
            { id: 'local', name: completion === 'failed' ? 'Local' : 'Saved during shutdown' },
          ],
        })
        expect(writes).toHaveLength(1)
        expect(states).toHaveLength(publicationsAtStop)
      } finally {
        writeGate.resolve()
        await writing
        await (stopping ?? Promise.allSettled([application.stop()]))
        await document.stop()
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it.each([
    'rename-project',
    'remove-project',
    'register-project',
    'repair-project-workspace',
  ] as const)(
    'retains truthful saved %s intent without reactivating a retired source',
    async (type) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-retired-save-')))
      const filename = join(root, 'roadmap.config.json')
      const project = { integration: 'local', id: 'fixture' } as const
      const additionalPath = join(root, 'additional')
      await mkdir(additionalPath)
      if (type === 'repair-project-workspace') {
        const git = promisify(execFile)
        await git('/usr/bin/git', ['init', root])
        await git('/usr/bin/git', [
          '-C',
          root,
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          'commit',
          '--allow-empty',
          '-m',
          'Fixture',
        ])
        await git('/usr/bin/git', ['clone', root, additionalPath])
      }
      const workspace = await inspectLocalWorkspace(root)
      const saved: ProjectConfiguration = {
        schemaVersion: 6,
        configurationVersion: 1,
        connections: [LOCAL],
        projects: [
          {
            ref: { integration: 'local', projectId: 'fixture' },
            connectionId: 'local',
            workspace: {
              path: root,
              ...(workspace.gitIdentity ? { gitIdentity: workspace.gitIdentity } : {}),
            },
            displayName: 'Before save',
          },
        ],
        automation: { enabled: false, enabledProjects: [] },
      }
      await writeFile(filename, JSON.stringify(saved))
      const document = createConfigurationDocument(filename)
      const entered = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<void>()
      const read = createSourceFixtureOwner()
      const source = controlledSourceFixture(
        project,
        read([localContent('fixture', root, type === 'repair-project-workspace')], 1_000),
      )
      let owners = 0
      const application = createRoadmapApplication({
        configuration: {
          ...document,
          async write(next) {
            entered.resolve()
            await gate.promise
            return document.write(next)
          },
        },
        admissions: { local: createLocalProjectAdmission() },
        observers: {
          local() {
            owners += 1
            return source.observer
          },
          github() {
            throw new Error('No GitHub source belongs to this schedule.')
          },
        },
        operations: harmlessHost(),
      })
      const publications: ApplicationState[] = []
      application.subscribe((state) => publications.push(state))
      let command: ReturnType<typeof application.execute> | undefined
      let stopping: Promise<void> | undefined
      try {
        await application.start()
        const observed = application.current().projects[0]?.resource
        command = application.execute(
          type === 'rename-project'
            ? { type, project, name: 'Saved after retirement', expectedConfigurationVersion: 1 }
            : type === 'remove-project'
              ? { type, project, expectedConfigurationVersion: 1 }
              : type === 'register-project'
                ? {
                    type,
                    candidate: {
                      integration: 'local',
                      connectionId: 'local',
                      workspace: { path: additionalPath },
                    },
                    expectedConfigurationVersion: 1,
                  }
                : {
                    type,
                    project,
                    workspace: { path: additionalPath },
                    expectedConfigurationVersion: 1,
                  },
        )
        await entered.promise
        stopping = application.stop()
        const publicationsAtStop = publications.length
        await vi.waitFor(() => expect(source.stopped).toBe(true))
        gate.resolve()
        const outcome = await command
        expect(outcome).toMatchObject({
          ok: true,
          result: { type: 'configuration-updated', configurationVersion: 2 },
          state: { configurationVersion: 2 },
        })
        expect(applicationStateCodec.decode(outcome.state).ok).toBe(true)
        const persisted: unknown = JSON.parse(await readFile(filename, 'utf8'))
        if (type === 'rename-project') {
          expect(persisted).toMatchObject({ projects: [{ displayName: 'Saved after retirement' }] })
          expect(outcome.state.registrations).toMatchObject([
            { displayName: 'Saved after retirement' },
          ])
          expect(outcome.state.projects[0]).toMatchObject({
            name: 'Saved after retirement',
            resource: observed,
          })
        } else if (type === 'remove-project') {
          expect(persisted).toMatchObject({ projects: [] })
          expect(outcome.state.registrations).toEqual([])
          expect(outcome.state.projects).toEqual([])
        } else if (type === 'register-project') {
          expect(persisted).toMatchObject({
            projects: [
              { ref: { projectId: 'fixture' }, workspace: { path: root } },
              { ref: { projectId: 'additional' }, workspace: { path: additionalPath } },
            ],
          })
          expect(outcome.state.projects[0]?.resource).toEqual(observed)
          expect(outcome.state.projects[1]).toMatchObject({
            key: { integration: 'local', id: 'additional' },
            workspace: { path: additionalPath },
            resource: { kind: 'never-observed', current: null },
            mapsMembership: { kind: 'never-observed', current: null },
            maps: [],
            activeMap: { kind: 'uncertain', reason: 'never-observed' },
          })
        } else {
          expect(persisted).toMatchObject({ projects: [{ workspace: { path: additionalPath } }] })
          expect(outcome.state.registrations[0]?.workspace.path).toBe(additionalPath)
          const retained = outcome.state.projects[0]
          expect(retained).toMatchObject({
            resource: {
              kind: 'retained-unavailable',
              unavailable: { kind: 'no-current-evidence' },
            },
            mapsMembership: { kind: 'unavailable' },
            activeMap: { kind: 'uncertain', reason: 'project-unavailable' },
          })
          expect(
            retained?.resource.kind === 'retained-unavailable'
              ? retained.resource.lastSuccessful
              : null,
          ).toEqual(observed?.kind === 'current-readable' ? observed.observation : null)
          expect(retained?.maps[0]).toMatchObject({
            resource: { kind: 'retained-unavailable' },
            ticketsMembership: { kind: 'unavailable' },
            tickets: [{ resource: { kind: 'retained-unavailable' } }],
          })
        }
        await stopping
        expect(application.current().registrations).toEqual(outcome.state.registrations)
        expect(application.current().projects).toEqual(outcome.state.projects)
        expect(application.current().automation.availability.status).toBe('unavailable')
        expect(
          application
            .current()
            .projects.flatMap((entry) => entry.actions)
            .some((action) => action.kind === 'server-launch'),
        ).toBe(false)
        expect(application.diagnostics().lifecycle.phase).toBe('stopped')
        source.push(read([localContent('fixture', root)], 2_000))
        expect(application.current().projects).toEqual(outcome.state.projects)
        expect(publications).toHaveLength(publicationsAtStop)
        expect(source.stopped).toBe(true)
        expect(owners).toBe(1)
      } finally {
        gate.resolve()
        await command
        await (stopping ?? application.stop())
        await document.stop()
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it('rejects a queued mutation that had not entered its serialized callback before shutdown', async () => {
    const writeEntered = Promise.withResolvers<void>()
    const writeGate = Promise.withResolvers<void>()
    const saved: ProjectConfiguration = {
      schemaVersion: 6,
      configurationVersion: 1,
      connections: [LOCAL],
      projects: [],
      automation: { enabled: false, enabledProjects: [] },
    }
    const memory = memoryConfiguration(saved)
    const writes: ProjectConfiguration[] = []
    const application = createRoadmapApplication({
      configuration: {
        ...memory.document,
        async write(next) {
          writes.push(next)
          writeEntered.resolve()
          await writeGate.promise
          return memory.document.write(next)
        },
      },
      admissions: {},
      observers: {
        local() {
          throw new Error('The mutation queue has no Local sources.')
        },
        github() {
          throw new Error('The mutation queue has no GitHub sources.')
        },
      },
    })
    await application.start()
    const first = application.execute({
      type: 'rename-connection',
      connectionId: 'local',
      name: 'Already admitted',
      expectedConfigurationVersion: 1,
    })
    const firstResult = Promise.allSettled([first])
    await writeEntered.promise
    const queued = application.execute({
      type: 'rename-connection',
      connectionId: 'local',
      name: 'Must not be admitted',
      expectedConfigurationVersion: 1,
    })
    const queuedResult = Promise.allSettled([queued])
    const stopping = Promise.allSettled([application.stop()])
    try {
      writeGate.resolve()
      const admitted = (await firstResult)[0]
      expect(admitted).toMatchObject({
        status: 'fulfilled',
        value: { ok: true, result: { type: 'configuration-updated', configurationVersion: 2 } },
      })
      expect((await queuedResult)[0]).toMatchObject({
        status: 'fulfilled',
        value: { ok: false, error: { code: 'not-supported' } },
      })
      expect(await stopping).toEqual([{ status: 'fulfilled', value: undefined }])
      expect(writes).toHaveLength(1)
      expect(writes[0]?.connections[0]?.name).toBe('Already admitted')
    } finally {
      writeGate.resolve()
      await Promise.all([firstResult, queuedResult, stopping])
    }
  })

  it.each(['success', 'failure'] as const)(
    'drains a begun host adapter and reports its honest %s without launching queued work',
    async (completion) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'roadmap-host-drain-')))
      const entered = Promise.withResolvers<void>()
      const host = Promise.withResolvers<void>()
      const effects: Array<{ executable: string; args: readonly string[] }> = []
      const saved: ProjectConfiguration = {
        schemaVersion: 6,
        configurationVersion: 1,
        connections: [LOCAL],
        projects: [
          {
            ref: { integration: 'local', projectId: 'host' },
            connectionId: 'local',
            workspace: { path: root },
          },
        ],
        automation: { enabled: false, enabledProjects: [] },
      }
      const configuration = memoryConfiguration(saved)
      const application = createRoadmapApplication({
        configuration: configuration.document,
        admissions: { local: createLocalProjectAdmission() },
        observers: {
          local(input) {
            const content = localContent(input.ref.projectId, input.workspace.path)
            const read = createSourceFixtureOwner()
            return controlledSourceFixture(content.key, read([content], 1_000)).observer
          },
          github() {
            throw new Error('The host drain has no GitHub sources.')
          },
        },
        operations: createApplicationOperations({
          async launch(executable, args) {
            effects.push({ executable, args })
            entered.resolve()
            await host.promise
          },
          async selectWorkspace() {
            throw new Error('The host drain must not open a selector.')
          },
        }),
      })
      let launched: ReturnType<typeof Promise.allSettled> | undefined
      let queued: ReturnType<typeof Promise.allSettled> | undefined
      let stopping: ReturnType<typeof Promise.allSettled> | undefined
      try {
        await application.start()
        launched = Promise.allSettled([
          application.execute({
            type: 'launch-action',
            actionId: 'open-workspace',
            project: { integration: 'local', id: 'host' },
            expectedConfigurationVersion: 1,
          }),
        ])
        await entered.promise
        queued = Promise.allSettled([
          application.execute({
            type: 'launch-action',
            actionId: 'open-terminal',
            project: { integration: 'local', id: 'host' },
            expectedConfigurationVersion: 1,
          }),
        ])
        let stopped = false
        stopping = Promise.allSettled([
          application.stop().then(() => {
            stopped = true
          }),
        ])
        await setImmediate()
        expect(stopped).toBe(false)
        expect(effects).toEqual([
          { executable: '/usr/bin/open', args: ['-a', 'Visual Studio Code', root] },
        ])
        if (completion === 'failure') host.reject(new Error('Private admitted host detail.'))
        else host.resolve()
        expect((await launched)[0]).toMatchObject(
          completion === 'success'
            ? {
                status: 'fulfilled',
                value: {
                  ok: true,
                  result: { type: 'action-launched', actionId: 'open-workspace' },
                },
              }
            : { status: 'fulfilled', value: { ok: false, error: { code: 'launch-failed' } } },
        )
        expect((await queued)[0]).toMatchObject({
          status: 'fulfilled',
          value: { ok: false, error: { code: 'not-supported' } },
        })
        expect(await stopping).toEqual([{ status: 'fulfilled', value: undefined }])
        expect(effects).toHaveLength(1)
        expect(JSON.stringify(await launched)).not.toContain('Private admitted host detail.')
      } finally {
        host.resolve()
        await Promise.all([launched, queued])
        await (stopping ?? Promise.allSettled([application.stop()]))
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})
