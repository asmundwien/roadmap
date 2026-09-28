import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { TextInput } from '@roadmap/ui/text-input'

export function TextInputCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Text input</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <label htmlFor="catalog-text-input-small">Small</label>
        <TextInput id="catalog-text-input-small" name="small" size="small" placeholder="Small" />
        <label htmlFor="catalog-text-input">Medium (default)</label>
        <TextInput id="catalog-text-input" name="name" placeholder="Medium" />
        <label htmlFor="catalog-text-input-large">Large</label>
        <TextInput id="catalog-text-input-large" name="large" size="large" placeholder="Large" />
      </SectionBody>
    </Section>
  )
}
