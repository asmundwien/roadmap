import {
  AliasPaletteCatalogSection,
  BadgesCatalogSection,
  CatalogHeader,
  ControlsCatalogSection,
  ReferencePaletteCatalogSection,
  RoadmapSignalsCatalogSection,
  TicketMarkCatalogSection,
  TinyTicketMarksCatalogSection,
} from './component-catalog'
import './component-catalog.css'

export function CatalogPage() {
  return (
    <main className="shell component-catalog">
      <CatalogHeader />
      <ReferencePaletteCatalogSection />
      <AliasPaletteCatalogSection />
      <TicketMarkCatalogSection />
      <TinyTicketMarksCatalogSection />
      <BadgesCatalogSection />
      <RoadmapSignalsCatalogSection />
      <ControlsCatalogSection />
    </main>
  )
}
