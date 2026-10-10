import type { CommandResult } from '@roadmap/contracts/operations'
import type { AuthorizationOperation, Connection } from '@roadmap/contracts/state'
import type { RoadmapViewState } from '@/store/roadmap-provider'

export type ConnectionOperation = Pick<RoadmapViewState, 'execute'>

export type AuthorizationPhaseResult = Extract<
  CommandResult,
  {
    type:
      | 'begin-github-authorization'
      | 'reauthorize-github-connection'
      | 'retry-github-authorization'
      | 'cancel-github-authorization'
  }
>

export type AuthorizationResultFeedback = {
  result: AuthorizationPhaseResult
  previous: AuthorizationOperation | undefined
  consumed: boolean
}

export function authorizationPhaseStatus(phase: AuthorizationPhaseResult['phase']): string {
  switch (phase) {
    case 'waiting':
      return 'Waiting for GitHub'
    case 'granted':
      return 'Authorized'
    case 'denied':
      return 'Authorization denied'
    case 'expired':
      return 'Authorization expired'
    case 'cancelled':
      return 'Authorization cancelled'
    case 'failed':
      return 'Authorization failed'
    default: {
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

function sameAuthorization(
  current: AuthorizationOperation,
  previous: AuthorizationOperation | undefined,
): boolean {
  if (!previous || current.id !== previous.id) return false
  switch (current.status) {
    case 'waiting':
      return (
        previous.status === 'waiting' &&
        current.verificationUri === previous.verificationUri &&
        current.userCode === previous.userCode &&
        current.expiresAt === previous.expiresAt &&
        current.connectionId === previous.connectionId
      )
    case 'granted':
      return (
        previous.status === 'granted' &&
        current.connection.kind === previous.connection.kind &&
        current.connection.id === previous.connection.id &&
        current.connection.accountId === previous.connection.accountId
      )
    case 'terminal':
      return (
        previous.status === 'terminal' &&
        current.outcome === previous.outcome &&
        current.connectionId === previous.connectionId &&
        ('cause' in current ? current.cause : undefined) ===
          ('cause' in previous ? previous.cause : undefined)
      )
    default: {
      const exhaustive: never = current
      return exhaustive
    }
  }
}

export function authorizationResultPending(
  authorization: AuthorizationOperation | undefined,
  feedback: AuthorizationResultFeedback | null,
): boolean {
  if (!feedback || feedback.consumed) return false
  return !authorization || sameAuthorization(authorization, feedback.previous)
}

export function consumeAuthorizationFeedback(
  authorization: AuthorizationOperation | undefined,
  feedback: AuthorizationResultFeedback,
): AuthorizationResultFeedback {
  return feedback.consumed || authorizationResultPending(authorization, feedback)
    ? feedback
    : { ...feedback, consumed: true }
}

export function connectionAvailability(connection: Connection): string {
  switch (connection.availability.status) {
    case 'available':
      return 'Available'
    case 'degraded':
      return 'Observation degraded'
    case 'authorization-required':
      return 'Authorization required'
    case 'unavailable':
      return 'Unavailable'
  }
}

export function authorizationStatus(authorization: AuthorizationOperation): string {
  switch (authorization.status) {
    case 'waiting':
    case 'granted':
      return authorizationPhaseStatus(authorization.status)
    case 'terminal':
      return authorizationPhaseStatus(authorization.outcome)
    default: {
      const exhaustive: never = authorization
      return exhaustive
    }
  }
}
