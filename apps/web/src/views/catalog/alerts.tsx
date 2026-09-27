import { Alert } from '@roadmap/ui/alert'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'

export function AlertsCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Alerts</SectionTitle>
        <SectionDescription>
          Persistent messages. Error alerts use role="alert" and announce immediately; informational
          alerts do not interrupt assistive technology.
        </SectionDescription>
      </SectionHeader>

      <SectionBody>
        <SectionGroup>
          <Alert>
            <strong>Action required.</strong>
            <span>The operation stays blocked until the problem is fixed.</span>
          </Alert>
        </SectionGroup>
        <SectionGroup>
          <Alert variant="info">
            <strong>Change saved.</strong>
            <span>The new configuration is active.</span>
          </Alert>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
