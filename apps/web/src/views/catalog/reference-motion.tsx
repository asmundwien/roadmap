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
import './reference-motion.css'

const DURATIONS = [
  ['150ms', '--ref-duration-150'],
  ['300ms', '--ref-duration-300'],
] as const

export function ReferenceMotionCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Reference motion</SectionTitle>
        <SectionDescription>
          Durations and easing curves describe movement, not an interaction. Semantic motion tokens
          choose which transition uses them. The samples stay still when reduced motion is
          preferred.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <SectionGroup>
          <SectionGroupTitle>Durations</SectionGroupTitle>
          <SectionGroupDescription>
            Hover or focus the comparison to move both markers the same distance. The short marker
            finishes in half the time of the medium one.
          </SectionGroupDescription>
          <div className="catalog-reference-motion-demo">
            <button type="button">Compare durations</button>
            {DURATIONS.map(([label, token]) => (
              <div className="catalog-reference-motion-row" key={token}>
                <strong>{label}</strong>
                <span className="catalog-reference-motion-track">
                  <span
                    className="catalog-reference-motion-marker"
                    style={{
                      transitionDuration: `var(${token})`,
                      transitionTimingFunction: 'var(--ref-easing-standard)',
                    }}
                  />
                </span>
                <code>{token}</code>
              </div>
            ))}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Easing</SectionGroupTitle>
          <SectionGroupDescription>
            Both markers take 300ms. Linear moves at a constant speed; the standard curve changes
            speed as it approaches the end. Linear is a comparison, not a reference token.
          </SectionGroupDescription>
          <div className="catalog-reference-motion-demo">
            <button type="button">Compare easing</button>
            <div className="catalog-reference-motion-row">
              <strong>Linear</strong>
              <span className="catalog-reference-motion-track">
                <span
                  className="catalog-reference-motion-marker"
                  style={{
                    transitionDuration: 'var(--ref-duration-300)',
                    transitionTimingFunction: 'linear',
                  }}
                />
              </span>
              <code>linear (baseline)</code>
            </div>
            <div className="catalog-reference-motion-row">
              <strong>Standard</strong>
              <span className="catalog-reference-motion-track">
                <span
                  className="catalog-reference-motion-marker"
                  style={{
                    transitionDuration: 'var(--ref-duration-300)',
                    transitionTimingFunction: 'var(--ref-easing-standard)',
                  }}
                />
              </span>
              <code>--ref-easing-standard</code>
            </div>
          </div>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
