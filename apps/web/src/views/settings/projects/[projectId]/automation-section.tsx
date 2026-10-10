import type { ProjectRef } from '@roadmap/contracts/identity'
import type { SafeError } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Toggle } from '@roadmap/ui/toggle'
import { useState } from 'react'
import { Link } from '@/navigation'
import { presentAutomation, resolveProject } from '@/resources/results'
import { routePaths, ticketPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { ErrorText, projectIdentity } from '@/views/shared/settings-shared'

type AutomationSectionProps = { projectRef: ProjectRef }

export function AutomationSection({ projectRef }: AutomationSectionProps) {
  const { project, globalAutomation, configuration, configurationVersion, command, execute } =
    useRoadmap((roadmap) => ({
      project: resolveProject(roadmap, projectRef),
      globalAutomation: presentAutomation(roadmap),
      configuration: roadmap.configuration,
      configurationVersion: roadmap.configurationVersion,
      command: roadmap.command,
      execute: roadmap.execute,
    }))
  const [error, setError] = useState<SafeError | string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const blocked = busy || command.inFlight || !configuration.valid
  const automation = project.automation
  const interruption = automation.reviewRequired
  const preferred = automation.projectEnabled
  const toggleState = busy ? 'pending' : preferred ? 'on' : 'off'

  const setEnabled = async (enabled: boolean) => {
    if (blocked || project.kind === 'missing') return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const outcome = await execute({
        type: 'set-project-automation-enabled',
        expectedConfigurationVersion: configurationVersion,
        project: projectRef,
        enabled,
      })
      if (!outcome.ok) setError(outcome.error)
      else {
        const result = outcome.result
        const identity = projectIdentity({ ref: result.project })
        const preference = result.enabled ? 'enabled' : 'disabled'
        const commit =
          result.commit === 'committed'
            ? `Automation preference ${preference} committed for ${identity} at configuration version ${result.configurationVersion}.`
            : `Automation preference ${preference} committed for ${identity} at configuration version ${result.configurationVersion}, but durability is unconfirmed. Check configuration before another change.`
        setNotice(
          interruption && result.enabled
            ? `${commit} Interruption acknowledgement does not establish the Session outcome. It remains unknown.`
            : commit,
        )
      }
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
          {project.kind === 'known' && (
            <Toggle
              state={interruption ? 'off' : toggleState}
              disabled={blocked || interruption}
              aria-describedby="project-automation-description"
              onChange={(event) => void setEnabled(event.currentTarget.checked)}
            >
              Enable automation for this project
            </Toggle>
          )}
          <SurfaceDescription id="project-automation-description">
            Allow automation to hand eligible frontier tasks to Wayfinder.
          </SurfaceDescription>
          {preferred && !globalAutomation.enabled && (
            <p>
              Automation is paused globally.{' '}
              <Link href={routePaths.connections}>Manage global automation</Link>
            </p>
          )}
          {globalAutomation.availabilityCause && (
            <Alert>
              <strong>Automation unavailable.</strong>
              <span>{globalAutomation.availabilityCause}</span>
            </Alert>
          )}
          {automation.interruptions.map((entry) => (
            <Alert key={JSON.stringify(entry.target)}>
              <strong>Session interrupted. Its outcome is unknown.</strong>
              <span>{entry.reason}</span>
              <span>
                Review any changes before enabling automation. Acknowledgement does not mean the
                Session succeeded. Queued work may resume when automation is enabled.
              </span>
              <Link href={ticketPath(entry.navigation.ticket)}>Review affected ticket</Link>
              <span>{entry.project.message}</span>
              <span>{entry.map.message}</span>
              <span>{entry.ticket.message}</span>
              {project.kind === 'known' && (
                <Button
                  type="button"
                  disabled={blocked}
                  aria-busy={busy || undefined}
                  onClick={() => void setEnabled(true)}
                >
                  Acknowledge interruption and enable
                </Button>
              )}
            </Alert>
          ))}
          {automation.historicalEvidence.map((entry) => (
            <Alert key={JSON.stringify(entry.target)} variant="info">
              <Link href={ticketPath(entry.navigation.ticket)}>Review affected ticket</Link>
              <span>{entry.project.message}</span>
              <span>{entry.map.message}</span>
              <span>{entry.ticket.message}</span>
            </Alert>
          ))}
          {automation.evidence.map((entry) => (
            <Surface
              key={JSON.stringify(entry.target)}
              role="region"
              aria-label="Automation evidence"
            >
              <Link href={ticketPath(entry.target)}>Inspect Automation evidence</Link>
              <section aria-label="Classification">
                <h4>Classification</h4>
                {entry.classification.facts.map((fact) => (
                  <p key={fact.term}>
                    {fact.term}: {fact.value}
                    {fact.detail && ` ${fact.detail}`}
                  </p>
                ))}
              </section>
              {entry.session && (
                <section aria-label="Wayfinder Session">
                  <h4>Wayfinder Session</h4>
                  {entry.session.facts.map((fact) => (
                    <p key={fact.term}>
                      {fact.term}: {fact.value}
                      {fact.detail && ` ${fact.detail}`}
                    </p>
                  ))}
                </section>
              )}
            </Surface>
          ))}
          {busy && interruption && <p role="status">Saving automation preference...</p>}
          {notice && <Alert variant="info">{notice}</Alert>}
          <ErrorText error={error} />
        </Surface>
      </SectionBody>
    </Section>
  )
}
