import { Alert } from '@roadmap/ui/alert'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription } from '@roadmap/ui/surface'
import { Toggle } from '@roadmap/ui/toggle'
import { Link } from '@/navigation'
import { presentAutomation } from '@/resources/results'
import { ticketPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import { automationEnablementFeedback } from '@/workflows/workflows'

export function AutomationSection() {
  const { automation, workflows, feedback } = useRoadmap((roadmap) => ({
    automation: presentAutomation(roadmap),
    workflows: roadmap.workflows,
    feedback: automationEnablementFeedback(roadmap.workflowState, {
      enabled: !roadmap.automation.enabled,
    }),
  }))

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Automation</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <Surface aria-busy={feedback.pending || undefined}>
          <Toggle
            state={feedback.pending ? 'pending' : automation.enabled ? 'on' : 'off'}
            disabled={feedback.blocked}
            onChange={(event) =>
              void workflows.setAutomationEnabled({ enabled: event.currentTarget.checked })
            }
          >
            Enable Automation
          </Toggle>
          <SurfaceDescription>Applies to all Projects with Automation enabled.</SurfaceDescription>
          {automation.availability.status === 'unavailable' && (
            <Alert>
              <strong>{automation.availabilityLabel}.</strong>
              <span>{automation.availabilityCause}</span>
            </Alert>
          )}
          {automation.interruptions.map((interruption) => (
            <Alert key={ticketPath(interruption.target)}>
              <section aria-label="Automation evidence">
                <span>{interruption.reason}</span>
                <p>{interruption.project.message}</p>
                <p>{interruption.map.message}</p>
                <p>{interruption.ticket.message}</p>
                <section aria-label="Classification">
                  <h4>Classification</h4>
                  {interruption.evidence.classification.facts.map((fact) => (
                    <p key={fact.term}>
                      {fact.term}: {fact.value}
                      {fact.detail ? ` · ${fact.detail}` : ''}
                    </p>
                  ))}
                </section>
                {interruption.evidence.session && (
                  <section aria-label="Wayfinder Session">
                    <h4>Wayfinder Session</h4>
                    {interruption.evidence.session.facts.map((fact) => (
                      <p key={fact.term}>
                        {fact.term}: {fact.value}
                        {fact.detail ? ` · ${fact.detail}` : ''}
                      </p>
                    ))}
                  </section>
                )}
                <Link href={ticketPath(interruption.target)}>Review interrupted Session</Link>
              </section>
            </Alert>
          ))}
          {automation.historicalEvidence.map((interruption) => (
            <Alert key={ticketPath(interruption.target)} variant="info">
              <section aria-label="Automation evidence">
                <span>{interruption.reason}</span>
                <p>{interruption.project.message}</p>
                <p>{interruption.map.message}</p>
                <p>{interruption.ticket.message}</p>
                <section aria-label="Classification">
                  <h4>Classification</h4>
                  {interruption.evidence.classification.facts.map((fact) => (
                    <p key={fact.term}>
                      {fact.term}: {fact.value}
                      {fact.detail ? ` · ${fact.detail}` : ''}
                    </p>
                  ))}
                </section>
                {interruption.evidence.session && (
                  <section aria-label="Wayfinder Session">
                    <h4>Wayfinder Session</h4>
                    {interruption.evidence.session.facts.map((fact) => (
                      <p key={fact.term}>
                        {fact.term}: {fact.value}
                        {fact.detail ? ` · ${fact.detail}` : ''}
                      </p>
                    ))}
                  </section>
                )}
                <Link href={ticketPath(interruption.target)}>Inspect recorded Session</Link>
              </section>
            </Alert>
          ))}
          <WorkflowFeedback feedback={feedback} workflows={workflows} />
        </Surface>
      </SectionBody>
    </Section>
  )
}
