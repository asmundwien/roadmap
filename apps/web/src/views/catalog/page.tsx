import { Page, PageDescription, PageEyebrow, PageHeader, PageTitle } from '@/components/page/page'
import { AlertsCatalogSection } from './alerts'
import { BadgesCatalogSection } from './badges'
import {
  ActionsCatalogSection,
  RoadmapSignalsCatalogSection,
  TicketMarkCatalogSection,
  TinyTicketMarksCatalogSection,
} from './components'
import { ReferencePaletteCatalogSection } from './reference'
import { SemanticPaletteCatalogSection } from './semantic'

export function CatalogPage() {
  return (
    <Page>
      <PageHeader>
        <PageEyebrow>UI inventory</PageEyebrow>
        <PageTitle>Components</PageTitle>
        <PageDescription>
          Shared marks, actions, and tokens. Each example uses the same classes and renderers as the
          product.
        </PageDescription>
      </PageHeader>

      <ReferencePaletteCatalogSection />
      <SemanticPaletteCatalogSection />
      <TicketMarkCatalogSection />
      <TinyTicketMarksCatalogSection />
      <BadgesCatalogSection />
      <AlertsCatalogSection />
      <RoadmapSignalsCatalogSection />
      <ActionsCatalogSection />
    </Page>
  )
}
