import {
  BadgesCatalogSection,
  CatalogHeader,
  ControlsCatalogSection,
  PaletteCatalogSection,
  RoadmapSignalsCatalogSection,
  TicketMarkCatalogSection,
  TinyTicketMarksCatalogSection,
} from './component-catalog'
import './component-catalog.css'

export function CatalogPage() {
  return (
    <main className="shell component-catalog">
      <CatalogHeader />
      <PaletteCatalogSection />
      <TicketMarkCatalogSection />
      <TinyTicketMarksCatalogSection />
      <BadgesCatalogSection />
      <RoadmapSignalsCatalogSection />
      <ControlsCatalogSection />
    </main>
  )
}
