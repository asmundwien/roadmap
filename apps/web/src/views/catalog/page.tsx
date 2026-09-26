import { AlertsCatalogSection } from './alerts'
import { BadgesCatalogSection } from './badges'
import {
  ControlsCatalogSection,
  RoadmapSignalsCatalogSection,
  TicketMarkCatalogSection,
  TinyTicketMarksCatalogSection,
} from './components'
import { CatalogHeader } from './header'
import { ReferencePaletteCatalogSection } from './reference'
import { SemanticPaletteCatalogSection } from './semantic'
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
