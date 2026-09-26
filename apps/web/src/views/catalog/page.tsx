import {
  BadgesCatalogSection,
  CatalogHeader,
  ControlsCatalogSection,
  ReferencePaletteCatalogSection,
  RoadmapSignalsCatalogSection,
  SemanticPaletteCatalogSection,
  TicketMarkCatalogSection,
  TinyTicketMarksCatalogSection,
} from './component-catalog'
import './component-catalog.css'

export function CatalogPage() {
  return (
    <main className="shell component-catalog">
      <CatalogHeader />
      <ReferencePaletteCatalogSection />
      <SemanticPaletteCatalogSection />
      <TicketMarkCatalogSection />
      <TinyTicketMarksCatalogSection />
      <BadgesCatalogSection />
      <RoadmapSignalsCatalogSection />
      <ControlsCatalogSection />
    </main>
  )
}
