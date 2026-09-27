import { Page, PageDescription, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { AlertsCatalogSection } from './alerts'
import { BadgesCatalogSection } from './badges'
import { ButtonsCatalogSection } from './buttons'
import { LinksCatalogSection } from './links'
import { MarkCatalogSection, TicketMarkCatalogSection } from './mark'
import { ReferenceColorsCatalogSection } from './reference-colors'
import { ReferenceDimensionsCatalogSection } from './reference-dimensions'
import { ReferenceMotionCatalogSection } from './reference-motion'
import { ReferenceTypographyCatalogSection } from './reference-typography'
import { SemanticPaletteCatalogSection } from './semantic'

export function CatalogPage() {
  return (
    <Page>
      <PageHeader>
        <PageEyebrow>UI inventory</PageEyebrow>
        <PageTitle>Components</PageTitle>
        <PageDescription>
          Reference values, semantic color roles, the mark primitive, and shared controls. The
          examples render with the same tokens as the product.
        </PageDescription>
      </PageHeader>

      <ReferenceColorsCatalogSection />
      <ReferenceTypographyCatalogSection />
      <ReferenceDimensionsCatalogSection />
      <ReferenceMotionCatalogSection />
      <SemanticPaletteCatalogSection />
      <MarkCatalogSection />
      <TicketMarkCatalogSection />
      <BadgesCatalogSection />
      <AlertsCatalogSection />
      <ButtonsCatalogSection />
      <LinksCatalogSection />
    </Page>
  )
}
