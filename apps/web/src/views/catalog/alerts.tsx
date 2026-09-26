import { Alert } from '@/components/alert/alert'
import { CatalogSection } from './section'
import './alerts.css'

export function AlertsCatalogSection() {
  return (
    <CatalogSection
      title="Alerts"
      description='Persistent messages. Error alerts use role="alert" and announce immediately; informational alerts do not interrupt assistive technology.'
    >
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
    </CatalogSection>
  )
}

type ComponentTokenListProps = { tokens: readonly string[] }

function ComponentTokenList({ tokens }: ComponentTokenListProps) {
  return (
    <div className="catalog-component-token-list">
      {tokens.map((token) => (
        <code key={token}>{token}</code>
      ))}
    </div>
  )
}
