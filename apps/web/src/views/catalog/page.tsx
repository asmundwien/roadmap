import { Page, PageDescription, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { AlertsCatalogSection } from './alerts'
import { BadgesCatalogSection } from './badges'
import { ButtonsCatalogSection } from './buttons'
import { ControlGroupCatalogSection } from './control-group'
import { LinksCatalogSection } from './links'
import { MarkCatalogSection, TicketMarkCatalogSection } from './mark'
import { ReferenceColorsCatalogSection } from './reference-colors'
import { ReferenceDimensionsCatalogSection } from './reference-dimensions'
import { ReferenceMotionCatalogSection } from './reference-motion'
import { ReferenceTypographyCatalogSection } from './reference-typography'
import { SemanticPaletteCatalogSection } from './semantic'
import { StandaloneSurfaceCatalogExample, SurfacesCatalogSection } from './surfaces'
import { TextInputCatalogSection } from './text-input'

export function CatalogPage() {
  return (
    <Page>
      <PageHeader>
        <PageEyebrow>UI inventory</PageEyebrow>
        <PageTitle>Components</PageTitle>
        <PageDescription>
          Reference values, semantic color roles, surfaces, the mark, and shared controls. The
          examples render with the same tokens as the product.
        </PageDescription>
      </PageHeader>

      <ReferenceColorsCatalogSection />
      <ReferenceTypographyCatalogSection />
      <ReferenceDimensionsCatalogSection />
      <ReferenceMotionCatalogSection />
      <SemanticPaletteCatalogSection />
      <SurfacesCatalogSection />
      <StandaloneSurfaceCatalogExample />
      <MarkCatalogSection />
      <TicketMarkCatalogSection />
      <BadgesCatalogSection />
      <AlertsCatalogSection />
      <ButtonsCatalogSection />
      <ControlGroupCatalogSection />
      <TextInputCatalogSection />
      <LinksCatalogSection />
    </Page>
  )
}
