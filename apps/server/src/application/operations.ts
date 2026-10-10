import type { ProjectRef } from '@roadmap/contracts/identity'
import {
  type Command,
  type CommandResult,
  commandResultSchema,
  type Query,
  type QueryResult,
  type SafeError,
} from '@roadmap/contracts/operations'
import type { HostExecutor, HostOperationResult } from '../host/operations.ts'
import type {
  ObservationAttempt,
  SourceContribution,
  SourceFailure,
} from '../observation/source.ts'
import type { WorkspaceAdmission } from '../projects/registry.ts'

type OperationCommand = Extract<Command, { type: 'launch-project-operation' }>
interface OperationContext {
  workspace(project: ProjectRef): Promise<WorkspaceAdmission | undefined>
  workspaceAdmissionError(project: ProjectRef): SafeError | null
}
type Rejection = { ok: false; error: SafeError }
type QueryResolution =
  | { ok: true; result: Extract<QueryResult, { ok: true }>['result'] }
  | Rejection
type LaunchResolution =
  | { ok: true; result: Extract<CommandResult, { type: 'launch-project-operation' }> }
  | Rejection
export interface ApplicationOperations {
  query(query: Query): Promise<QueryResolution>
  execute(command: OperationCommand, context: OperationContext): Promise<LaunchResolution>
}
export interface ApplicationOperationOptions {
  host: HostExecutor
}

export function createApplicationOperations(
  options: ApplicationOperationOptions,
): ApplicationOperations {
  return {
    async query(query) {
      switch (query.type) {
        case 'select-workspace':
          try {
            const selection = await options.host.execute({ type: 'select-workspace' })
            switch (selection.kind) {
              case 'selected':
                return { ok: true, result: { kind: 'selected', path: selection.path } }
              case 'cancelled':
                return { ok: true, result: { kind: 'cancelled' } }
              case 'invoked':
                return selectionFailed()
              default: {
                const exhaustive: never = selection
                throw new Error(`Unknown host selection: ${exhaustive}`)
              }
            }
          } catch {
            return selectionFailed()
          }
        default: {
          const exhaustive: never = query.type
          throw new Error(`Unknown interaction query: ${exhaustive}`)
        }
      }
    },
    async execute(command, context) {
      const workspace = await context.workspace(command.project)
      if (!workspace) return invalid('project', 'Project does not exist.')
      if (workspace.status !== 'admitted')
        return {
          ok: false,
          error: {
            code: 'admission-failed',
            field: 'workspace.path',
            message:
              workspace.status === 'unavailable'
                ? workspace.error.message
                : 'Workspace has not been admitted.',
          },
        }
      const operation = {
        project: { integration: command.project.integration, projectId: command.project.projectId },
        workspacePath: workspace.proof.path,
      }
      const admissionError = context.workspaceAdmissionError(command.project)
      if (admissionError) return { ok: false, error: admissionError }
      try {
        let invocation: HostOperationResult
        switch (command.operation) {
          case 'open-workspace':
            invocation = await options.host.execute({ type: 'open-workspace', ...operation })
            break
          case 'open-terminal':
            invocation = await options.host.execute({ type: 'open-terminal', ...operation })
            break
          case 'reveal-source':
            invocation = await options.host.execute({ type: 'reveal-source', ...operation })
            break
          default: {
            const exhaustive: never = command.operation
            throw new Error(`Unknown Project operation: ${exhaustive}`)
          }
        }
        if (invocation.kind !== 'invoked') return launchFailed()
        return {
          ok: true,
          result: {
            type: 'launch-project-operation',
            project: command.project,
            operation: command.operation,
            status: 'invoked',
          },
        }
      } catch {
        return launchFailed()
      }
    },
  }
}

export interface RefreshObservation {
  project: ProjectRef
  contribution: SourceContribution
  previousObservedAt: number | null
}
type RefreshResolution =
  | { ok: true; result: Extract<CommandResult, { type: 'refresh-project' }> }
  | Rejection

export function translateRefreshOutcome(refresh: RefreshObservation | null): RefreshResolution {
  if (!refresh) return invalid('project', 'Project does not have an active source observer.')
  const { contribution, previousObservedAt } = refresh
  const root = contribution.attempts.find((attempt) => attempt.scope.kind === 'project')
  if (!root) return invalid('project', 'The source refresh did not establish a Project attempt.')
  let attempt: unknown
  if (root.kind === 'proven-absent') {
    attempt = {
      kind: 'proven-absent',
      attemptedAt: root.attemptedAt,
      observedAt: root.observedAt,
      provenance: root.provenance,
    }
  } else {
    const active = activeAttempts(contribution)
    const problem = active.find(
      (entry) =>
        entry.kind === 'failed' ||
        (entry.kind === 'observed' &&
          (entry.completeness.kind === 'incomplete' ||
            (entry.scope.kind === 'ticket' &&
              'blockersComplete' in entry.value &&
              !entry.value.blockersComplete))),
    )
    const incomplete = !hasCompleteNamedScopes(active) || contribution.health.status !== 'available'
    if (problem || incomplete) {
      const evidence = problem ?? root
      const observedAt = previousObservedAt ?? (root.kind === 'observed' ? root.observedAt : null)
      const metadata = {
        attemptedAt: evidence.attemptedAt,
        provenance: evidence.provenance,
        cause:
          evidence.kind === 'failed'
            ? failureCause(evidence.failure)
            : 'Current source evidence is incomplete.',
      }
      attempt =
        observedAt === null
          ? { kind: 'failed', ...metadata }
          : { kind: 'degraded', ...metadata, observedAt }
    } else {
      if (root.kind !== 'observed')
        return invalid('project', 'The source refresh did not establish a Project observation.')
      attempt = {
        kind: 'observed',
        attemptedAt: root.attemptedAt,
        observedAt: root.observedAt,
        provenance: root.provenance,
      }
    }
  }
  // Translate private source identities through the authoritative browser-safe result schema.
  const result = commandResultSchema.parse({
    type: 'refresh-project',
    project: refresh.project,
    attempt,
  })
  if (result.type !== 'refresh-project')
    throw new Error('The source refresh returned another operation result.')
  return { ok: true, result }
}

function activeAttempts(contribution: SourceContribution): readonly ObservationAttempt[] {
  const membership = contribution.attempts.find((entry) => entry.scope.kind === 'maps-membership')
  return contribution.attempts.filter((entry) => {
    if (entry.scope.kind === 'project' || entry.scope.kind === 'maps-membership') return true
    const map = entry.scope.kind === 'ticket' ? entry.scope.ticket.map : entry.scope.map
    if (
      membership?.kind === 'observed' &&
      'members' in membership.value &&
      membership.completeness.kind === 'complete'
    ) {
      if (
        !membership.value.members.some((member) => 'mapId' in member && member.mapId === map.mapId)
      )
        return false
    }
    if (entry.scope.kind !== 'ticket') return true
    const ticketId = entry.scope.ticket.ticketId
    const ticketMembership = contribution.attempts.find(
      (candidate) =>
        candidate.scope.kind === 'tickets-membership' && candidate.scope.map.mapId === map.mapId,
    )
    if (
      ticketMembership?.kind !== 'observed' ||
      !('members' in ticketMembership.value) ||
      ticketMembership.completeness.kind !== 'complete'
    )
      return true
    return ticketMembership.value.members.some(
      (member) => 'ticketId' in member && member.ticketId === ticketId,
    )
  })
}

function hasCompleteNamedScopes(attempts: readonly ObservationAttempt[]): boolean {
  const membership = attempts.find((entry) => entry.scope.kind === 'maps-membership')
  if (
    membership?.kind !== 'observed' ||
    !('members' in membership.value) ||
    membership.completeness.kind !== 'complete'
  )
    return false
  for (const member of membership.value.members) {
    if (!('mapId' in member)) return false
    const map = attempts.find(
      (entry) => entry.scope.kind === 'map' && entry.scope.map.mapId === member.mapId,
    )
    const tickets = attempts.find(
      (entry) =>
        entry.scope.kind === 'tickets-membership' && entry.scope.map.mapId === member.mapId,
    )
    if (
      map?.kind !== 'observed' ||
      map.completeness.kind !== 'complete' ||
      tickets?.kind !== 'observed' ||
      !('members' in tickets.value) ||
      tickets.completeness.kind !== 'complete'
    )
      return false
    for (const ticket of tickets.value.members) {
      if (!('ticketId' in ticket)) return false
      const observation = attempts.find(
        (entry) =>
          entry.scope.kind === 'ticket' &&
          entry.scope.ticket.map.mapId === member.mapId &&
          entry.scope.ticket.ticketId === ticket.ticketId,
      )
      if (observation?.kind !== 'observed' || observation.completeness.kind !== 'complete')
        return false
    }
  }
  return true
}

function failureCause(failure: SourceFailure): string {
  switch (failure.kind) {
    case 'filesystem':
      if (failure.operation === 'inspect-root')
        return failure.code === 'EACCES'
          ? 'Workspace read permission was denied.'
          : 'Workspace cannot be read.'
      return failure.code === 'ENOENT'
        ? 'Source path is currently missing.'
        : failure.code === 'EACCES'
          ? 'Source read permission was denied.'
          : 'Source path cannot be read.'
    case 'transient':
      return failure.cause === 'rate-limit'
        ? 'GitHub rate limit prevents this read.'
        : 'GitHub is temporarily unreachable.'
    case 'execution':
      return 'GitHub could not execute this source read.'
    case 'read':
      return failure.cause === 'response-read'
        ? 'GitHub response could not be read.'
        : 'Source response is malformed.'
    case 'access-unavailable':
      return 'GitHub access is currently unavailable.'
    case 'authorization':
      return 'GitHub authorization is required.'
    case 'access-ambiguous':
      return 'GitHub source is inaccessible; absence is not proven.'
    case 'identity-mismatch':
      return 'GitHub repository identity does not match the admitted Project.'
    default: {
      const exhaustive: never = failure
      throw new Error(`Unknown source failure: ${exhaustive}`)
    }
  }
}

function invalid(field: string, message: string): Rejection {
  return { ok: false, error: { code: 'validation', field, message } }
}
function selectionFailed(): Rejection {
  return {
    ok: false,
    error: { code: 'selection-failed', message: 'The folder selector could not be opened.' },
  }
}
function launchFailed(): Rejection {
  return {
    ok: false,
    error: {
      code: 'launch-failed',
      field: 'operation',
      message: 'The requested application could not be opened.',
    },
  }
}
