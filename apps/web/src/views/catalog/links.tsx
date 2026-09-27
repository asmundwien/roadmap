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
          <SectionGroupTitle>Default</SectionGroupTitle>
          <SectionGroupDescription>
            Underlined text identifies navigation without button borders or a button group.
          </SectionGroupDescription>
          <Link href="#/components">Components</Link>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
