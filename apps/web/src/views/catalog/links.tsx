import { Link } from '@roadmap/ui/link'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionGroup,
  SectionGroupDescription,
  SectionGroupTitle,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'

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
        <SectionGroup>
          <SectionGroupTitle>Internal</SectionGroupTitle>
          <SectionGroupDescription>
            Underlined text with a right arrow identifies navigation within the application.
          </SectionGroupDescription>
          <Link href="#/components">Components</Link>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>External</SectionGroupTitle>
          <SectionGroupDescription>
            An up-right arrow marks a destination that opens in a new tab.
          </SectionGroupDescription>
          <Link href="https://github.com" external>
            GitHub
          </Link>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
