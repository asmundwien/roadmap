import type { Connection } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'

type AvailabilityLabelProps = { connection: Connection }

export function AvailabilityLabel({ connection }: AvailabilityLabelProps) {
  if (connection.availability.status === 'available') return null

  const label = availabilityLabel(connection)

  return (
    <Alert>
      <strong>{label}</strong>
      <span>{connection.availability.cause}</span>
    </Alert>
  )
}

function availabilityLabel(connection: Connection): string {
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
