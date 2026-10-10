import type { ProjectRef } from '@roadmap/contracts/identity'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Toggle } from '@roadmap/ui/toggle'
import { Link } from '@/navigation'
import { presentAutomation, resolveProject } from '@/resources/results'
import { routePaths, ticketPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import { automationEnablementFeedback } from '@/workflows/workflows'

type AutomationSectionProps = { projectRef: ProjectRef }

export function AutomationSection({ projectRef }: AutomationSectionProps) {
  const { project, globalAutomation, workflows, feedback } = useRoadmap((roadmap) => {
    const project = resolveProject(roadmap, projectRef)
    return {
      project,
      globalAutomation: presentAutomation(roadmap),
      workflows: roadmap.workflows,
      feedback: automationEnablementFeedback(roadmap.workflowState, {
        project: projectRef,
        enabled: !project.automation.projectEnabled || project.automation.reviewRequired,
      }),
    }
  })
  const automation = project.automation
  const interruption = automation.reviewRequired
  const preferred = automation.projectEnabled
  const toggleState = feedback.pending ? 'pending' : preferred ? 'on' : 'off'
  const setEnabled = (enabled: boolean) =>
    workflows.setProjectAutomationEnabled({ project: projectRef, enabled })

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
              disabled={feedback.blocked || feedback.pending || interruption}
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
                  disabled={feedback.blocked || feedback.pending}
                  aria-busy={feedback.pending || undefined}
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
          <WorkflowFeedback feedback={feedback} workflows={workflows} />
        </Surface>
      </SectionBody>
    </Section>
  )
}
