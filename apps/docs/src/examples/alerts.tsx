import { Alert } from '@roadmap/ui/alert'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface } from '@roadmap/ui/surface'

export function AlertsPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Alerts</PageTitle>
        <PageDescription>
          Persistent messages. Error alerts use role="alert" and announce immediately; informational
          alerts do not interrupt assistive technology.
        </PageDescription>
      </PageHeader>

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
    </>
  )
}
