import { AlertsCatalogSection } from './alerts-catalog-section'
import { BadgesCatalogSection } from './badges-catalog-section'
import { CatalogHeader } from './catalog-header'
import {
  ControlsCatalogSection,
  RoadmapSignalsCatalogSection,
  TicketMarkCatalogSection,
  TinyTicketMarksCatalogSection,
} from './component-catalog'
import { ReferencePaletteCatalogSection } from './reference-palette-catalog-section'
import { SemanticPaletteCatalogSection } from './semantic-palette-catalog-section'
import './page.css'

export function CatalogPage() {
  return (
    <main className="shell component-catalog">
      <CatalogHeader />
      <ReferencePaletteCatalogSection />
      <SemanticPaletteCatalogSection />
      <TicketMarkCatalogSection />
      <TinyTicketMarksCatalogSection />
      <BadgesCatalogSection />
      <AlertsCatalogSection />
      <RoadmapSignalsCatalogSection />
      <ControlsCatalogSection />
    </main>
  )
}
