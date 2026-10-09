import type { SafeError } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Toggle } from '@roadmap/ui/toggle'
import { useState } from 'react'
import { useRoadmap } from '@/store/roadmap-provider'
import { ErrorText } from '@/views/shared/settings-shared'

export function AutomationSection() {
  const { automation, configuration, configurationVersion, command, execute } = useRoadmap()
  const [error, setError] = useState<SafeError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const blocked = busy || command.inFlight || !configuration.valid
  const ready = automation.availability.status === 'ready'

  const setEnabled = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await execute({
        type: 'set-automation-enabled',
        expectedConfigurationVersion: configurationVersion,
        enabled,
      })
      if (!outcome.ok) setError(outcome.error)
    } catch {
      setError('The change may have completed. Check the relevant configuration before retrying.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Automation</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <Surface aria-busy={busy || undefined}>
          <Toggle
            state={busy ? 'pending' : automation.enabled ? 'on' : 'off'}
            disabled={blocked || (!ready && !automation.enabled)}
            onChange={(event) => void setEnabled(event.currentTarget.checked)}
          >
            Enable Automation
          </Toggle>
          <SurfaceDescription>Applies to all Projects with Automation enabled.</SurfaceDescription>
          {automation.availability.status === 'unavailable' && (
            <Alert>
              <strong>Automation unavailable.</strong>
              <span>{automation.availability.cause}</span>
            </Alert>
          )}
          <ErrorText error={error} />
        </Surface>
      </SectionBody>
    </Section>
  )
}
