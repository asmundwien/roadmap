import { Page, PageDescription, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { TicketMarkCatalogSection } from './mark'

export function CatalogPage() {
  return (
    <Page>
      <PageHeader>
        <PageEyebrow>Roadmap presentation</PageEyebrow>
        <PageTitle>Components</PageTitle>
        <PageDescription>
          The ticket mark maps Roadmap state and type to the shared Mark primitive. Shared
          components and design tokens are documented in the separate documentation app.
        </PageDescription>
      </PageHeader>

      <TicketMarkCatalogSection />
    </Page>
  )
}
