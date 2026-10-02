import { Alert } from '@roadmap/ui/alert'
import { PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionDescription, SectionHeader } from '@roadmap/ui/section'
import { Surface } from '@roadmap/ui/surface'

export function AlertsCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <PageTitle>Alerts</PageTitle>
        <SectionDescription>
          Persistent messages. Error alerts use role="alert" and announce immediately; informational
          alerts do not interrupt assistive technology.
        </SectionDescription>
      </SectionHeader>

      <SectionBody>
        <Surface>
          <Alert>
            <strong>Action required.</strong>
            <span>The operation stays blocked until the problem is fixed.</span>
          </Alert>
        </Surface>
        <Surface>
          <Alert variant="info">
            <strong>Change saved.</strong>
            <span>The new configuration is active.</span>
          </Alert>
        </Surface>
      </SectionBody>
    </Section>
  )
}
