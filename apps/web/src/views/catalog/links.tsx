import { Link } from '@roadmap/ui/link'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'

export function LinksCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Links</SectionTitle>
        <SectionDescription>
          Links navigate to a destination and remain separate from buttons.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <Surface>
          <SurfaceTitle>Internal</SurfaceTitle>
          <SurfaceDescription>
            Underlined text with a right arrow identifies navigation within the application.
          </SurfaceDescription>
          <Link href="#/components">Components</Link>
        </Surface>
        <Surface>
          <SurfaceTitle>External</SurfaceTitle>
          <SurfaceDescription>
            An up-right arrow marks a destination that opens in a new tab.
          </SurfaceDescription>
          <Link href="https://github.com" external>
            GitHub
          </Link>
        </Surface>
      </SectionBody>
    </Section>
  )
}
