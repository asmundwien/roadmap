import { Page, PageDescription, PageEyebrow, PageHeader, PageTitle } from '@/components/page/page'
import { ActionsCatalogSection } from './actions'
import { AlertsCatalogSection } from './alerts'
import { BadgesCatalogSection } from './badges'
import { MarkCatalogSection, TicketMarkCatalogSection } from './mark'
import { ReferencePaletteCatalogSection } from './reference'
import { SemanticPaletteCatalogSection } from './semantic'

export function CatalogPage() {
  return (
    <Page>
      <PageHeader>
        <PageEyebrow>UI inventory</PageEyebrow>
        <PageTitle>Components</PageTitle>
        <PageDescription>
          The color layers, the mark primitive, and the shared controls. Every example renders
          through the same components and tokens as the product.
        </PageDescription>
      </PageHeader>

      <ReferencePaletteCatalogSection />
      <SemanticPaletteCatalogSection />
      <MarkCatalogSection />
      <TicketMarkCatalogSection />
      <BadgesCatalogSection />
      <AlertsCatalogSection />
      <ActionsCatalogSection />
    </Page>
  )
}
