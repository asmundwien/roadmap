import type {
  AuthorizationOperation,
  Command,
  CommandOutcome,
  Connection,
} from '@roadmap/contracts'

export interface ConnectionOperation {
  execute(command: Command): Promise<CommandOutcome>
}

export function connectionAuthorization(
  operations: AuthorizationOperation[],
  connectionId: string,
): AuthorizationOperation | undefined {
  const related = operations.filter((operation) => operation.connectionId === connectionId)
  return related.findLast((operation) => operation.status === 'waiting') ?? related.at(-1)
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
  }
}
