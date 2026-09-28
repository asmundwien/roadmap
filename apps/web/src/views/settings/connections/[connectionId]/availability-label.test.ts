import type { Connection, ConnectionAvailability } from '@roadmap/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AvailabilityLabel } from './availability-label'

function renderAvailability(availability: ConnectionAvailability): string {
  const connection: Connection = {
    id: 'github/work',
    integration: 'github',
    name: 'Work',
    builtIn: false,
    availability,
  }
  return renderToStaticMarkup(createElement(AvailabilityLabel, { connection }))
}

describe('AvailabilityLabel', () => {
  it('omits the alert for an available connection', () => {
    expect(renderAvailability({ status: 'available' })).toBe('')
  })

  it.each([
    [
      { status: 'degraded', cause: 'Observations are delayed.', observedAt: 100 },
      'Observation degraded',
    ],
    [{ status: 'authorization-required', cause: 'Token expired.' }, 'Authorization required'],
    [{ status: 'unavailable', cause: 'Repository cannot be read.' }, 'Unavailable'],
  ] satisfies [ConnectionAvailability, string][])(
    'shows the %s status and its cause in an alert',
    (availability, label) => {
      const markup = renderAvailability(availability)
      expect(markup).toContain('role="alert"')
      expect(markup).toContain(`<strong>${label}</strong>`)
      expect(markup).toContain(`<span>${availability.cause}</span>`)
    },
  )
})
