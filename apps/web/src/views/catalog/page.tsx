import { Page, PageDescription, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import type { CatalogTab } from '@/router'
import { ActionsCatalogSection } from './actions'
import { AlertsCatalogSection } from './alerts'
import { BadgesCatalogSection } from './badges'
import { CatalogNav } from './catalog-nav'
import './catalog.css'
import { MarkCatalogSection } from './mark'
import { ReferencePaletteCatalogSection } from './reference'
import { SemanticPaletteCatalogSection } from './semantic'
import { TicketMarkCatalogSection } from './ticket-mark'

type CatalogPageProps = { tab: CatalogTab }

export function CatalogPage({ tab }: CatalogPageProps) {
  return (
    <Page>
      <PageHeader>
        <PageEyebrow>UI inventory</PageEyebrow>
        <PageTitle>Components</PageTitle>
        <PageDescription>
          {tab === 'design-system'
            ? 'What @roadmap/ui publishes: the token layers and the presentational components views compose. Nothing here reads a domain type.'
            : 'What the views build on top of the design system. These components take domain types as props and own the encoding that turns them into presentation.'}
        </PageDescription>
      </PageHeader>

      <div className="catalog-layout">
        <CatalogNav className="catalog-rail" tab={tab} />
        <div className="catalog-sections">
          {tab === 'design-system' ? <DesignSystemSections /> : <DomainSections />}
        </div>
      </div>
    </Page>
  )
}

function DesignSystemSections() {
  return (
    <>
      <ReferencePaletteCatalogSection />
      <SemanticPaletteCatalogSection />
      <MarkCatalogSection />
      <BadgesCatalogSection />
      <AlertsCatalogSection />
      <ActionsCatalogSection />
    </>
  )
}

function DomainSections() {
  return <TicketMarkCatalogSection />
}
