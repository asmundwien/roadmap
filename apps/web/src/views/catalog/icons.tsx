import { Icon, icon } from '@roadmap/ui/icon'
import { Section, SectionDescription, SectionHeader, SectionTitle } from '@roadmap/ui/section'

const ICONS = Object.values(icon)

export function IconsCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Icons</SectionTitle>
        <SectionDescription>
          Decorative symbols inherit text color. Pair each icon with a text label.
        </SectionDescription>
      </SectionHeader>
      <div className="catalog-component-examples">
        {ICONS.map((iconName) => (
          <div className="catalog-component-example" key={iconName}>
            <Icon icon={iconName} />
            <span>{iconName}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}
