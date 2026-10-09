import type { AuthorizationOperation, Connection } from '@roadmap/contracts/state'
import type { RoadmapViewState } from '@/store/roadmap-provider'

export type ConnectionOperation = Pick<RoadmapViewState, 'execute'>

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
    case 'terminal':
      switch (authorization.outcome) {
        case 'denied':
          return 'Authorization denied'
        case 'expired':
          return 'Authorization expired'
        case 'cancelled':
          return 'Authorization cancelled'
        case 'failed':
          return 'Authorization failed'
        default: {
          const exhaustive: never = authorization
          return exhaustive
        }
      }
    default: {
      const exhaustive: never = authorization
      return exhaustive
    }
  }
}
