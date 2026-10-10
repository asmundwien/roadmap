import type { SafeError } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Toggle } from '@roadmap/ui/toggle'
import { useState } from 'react'
import { useRoadmap } from '@/store/roadmap-provider'
import { ErrorText } from '@/views/shared/settings-shared'

export function AutomationSection() {
  const { automation, configuration, configurationVersion, command, execute } = useRoadmap(
    (roadmap) => ({
      automation: roadmap.automation,
      configuration: { valid: roadmap.configuration.valid },
      configurationVersion: roadmap.configurationVersion,
      command: { inFlight: roadmap.command.inFlight },
      execute: roadmap.execute,
    }),
  )
  const [error, setError] = useState<SafeError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const blocked = busy || command.inFlight || !configuration.valid
  const ready = automation.availability.status === 'ready'

  const setEnabled = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const outcome = await execute({
        type: 'set-automation-enabled',
        expectedConfigurationVersion: configurationVersion,
        enabled,
      })
      if (!outcome.ok) setError(outcome.error)
      else {
        const result = outcome.result
        setFeedback(
          result.commit === 'committed-unconfirmed'
            ? `Global Automation ${result.enabled ? 'enablement' : 'disablement'} was committed at configuration version ${result.configurationVersion}, but durability is unconfirmed.`
            : `Global Automation ${result.enabled ? 'enablement' : 'disablement'} was committed at configuration version ${result.configurationVersion}.`,
        )
      }
    } catch {
      setError(
        'The Global Automation change outcome is unknown because its reply was lost. Roadmap will not retry it.',
      )
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
          {feedback !== null && (
            <div role="status">
              <Alert variant="info">{feedback}</Alert>
            </div>
          )}
        </Surface>
      </SectionBody>
    </Section>
  )
}
