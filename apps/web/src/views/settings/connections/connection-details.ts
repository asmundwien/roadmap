import type { AuthorizationOperation, Connection } from '@roadmap/contracts'
import type { RoadmapStore } from '../../../store/roadmap-store'

export type ConnectionOperation = Pick<RoadmapStore, 'execute'>

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
