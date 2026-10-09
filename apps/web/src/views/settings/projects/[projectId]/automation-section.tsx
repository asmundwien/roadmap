import type { SafeError } from '@roadmap/contracts/operations'
import type { Project } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Toggle } from '@roadmap/ui/toggle'
import { useState } from 'react'
import { Link } from '@/navigation'
import { routePaths, ticketPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { unacknowledgedInterruption } from '@/views/settings/project-automation'
import { resourceMessage } from '@/views/shared/resource-results'
import { ErrorText, sameProject } from '@/views/shared/settings-shared'

type AutomationSectionProps = { project: Project }

export function AutomationSection({ project }: AutomationSectionProps) {
  const { automation, configuration, configurationVersion, command, execute } = useRoadmap()
  const [error, setError] = useState<SafeError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const blocked = busy || command.inFlight || !configuration.valid
  const interruption = unacknowledgedInterruption(project.ref, automation.evidence)
  const preferred = automation.enabledProjects.some((key) => sameProject(key, project.ref))
  const toggleState = busy ? 'pending' : preferred ? 'on' : 'off'
  const affectedMap = interruption
    ? project.maps.find(
        (map) =>
          map.ref.mapId === interruption.target.map.mapId &&
          sameProject(map.ref.project, project.ref),
      )
    : undefined
  const affectedTicket = affectedMap?.tickets.find(
    (ticket) => ticket.ref.ticketId === interruption?.target.ticketId,
  )

  const setEnabled = async (enabled: boolean) => {
    if (blocked) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await execute({
        type: 'set-project-automation-enabled',
        expectedConfigurationVersion: configurationVersion,
        project: project.ref,
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
        <Surface>
          <Toggle
            state={interruption ? 'off' : toggleState}
            disabled={blocked || interruption !== undefined}
            aria-describedby="project-automation-description"
            onChange={(event) => void setEnabled(event.currentTarget.checked)}
          >
            Enable automation for this project
          </Toggle>
          <SurfaceDescription id="project-automation-description">
            Allow automation to hand eligible frontier tasks to Wayfinder.
          </SurfaceDescription>
          {preferred && !automation.enabled && (
            <p>
              Automation is paused globally.{' '}
              <Link href={routePaths.connections}>Manage global automation</Link>
            </p>
          )}
          {automation.availability.status === 'unavailable' && (
            <Alert>
              <strong>Automation unavailable.</strong>
              <span>{automation.availability.cause}</span>
            </Alert>
          )}
          {interruption && (
            <Alert>
              <strong>Session interrupted. Its outcome is unknown.</strong>
              <span>
                Review any changes before enabling automation. Acknowledgement does not mean the
                Session succeeded. Queued work may resume when automation is enabled.
              </span>
              {affectedMap && affectedTicket && (
                <>
                  <Link href={ticketPath(affectedTicket.ref)}>Review affected ticket</Link>
                  <span>{resourceMessage(affectedMap.resource)}</span>
                  <span>{resourceMessage(affectedTicket.resource)}</span>
                </>
              )}
              <Button
                type="button"
                disabled={blocked}
                aria-busy={busy || undefined}
                onClick={() => void setEnabled(true)}
              >
                Acknowledge interruption and enable
              </Button>
            </Alert>
          )}
          {busy && interruption && <p role="status">Saving automation preference...</p>}
          <ErrorText error={error} />
        </Surface>
      </SectionBody>
    </Section>
  )
}
