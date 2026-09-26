import { Alert } from '@roadmap/ui/alert'
import { Section, SectionDescription, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { ComponentTokenList } from './token-list'
import './alerts.css'

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

      <div className="catalog-alert-examples">
        <div className="catalog-alert-example">
          <Alert>
            <strong>Action required.</strong>
            <span>The operation stays blocked until the problem is fixed.</span>
          </Alert>
          <ComponentTokenList
            tokens={[
              '--comp-alert-outline-color',
              '--comp-alert-error-accent-color',
              '--comp-alert-error-container-color',
              '--comp-alert-error-content-color',
            ]}
          />
        </div>
        <div className="catalog-alert-example">
          <Alert variant="info">
            <strong>Change saved.</strong>
            <span>The new configuration is active.</span>
          </Alert>
          <ComponentTokenList
            tokens={[
              '--comp-alert-outline-color',
              '--comp-alert-info-accent-color',
              '--comp-alert-info-container-color',
              '--comp-alert-info-content-color',
            ]}
          />
        </div>
      </div>
    </Section>
  )
}
