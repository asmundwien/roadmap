import {
  Section,
  SectionBody,
  SectionDescription,
  SectionGroup,
  SectionGroupTitle,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import './reference.css'

const REFERENCE_COLOR_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
const REFERENCE_COLOR_FAMILIES = [
  ['Neutral', 'neutral'],
  ['Gold', 'gold'],
  ['Blue', 'blue'],
  ['Green', 'green'],
  ['Rose', 'rose'],
  ['Violet', 'violet'],
  ['Teal', 'teal'],
] as const
const COMMON_REFERENCE_COLORS = [
  ['White', '--ref-white'],
  ['Black', '--ref-black'],
] as const

export function ReferencePaletteCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Reference layer</SectionTitle>
        <SectionDescription>
          Literal color values without semantic or component meaning.
        </SectionDescription>
      </SectionHeader>

      <SectionBody>
        <SectionGroup>
          <SectionGroupTitle>Common</SectionGroupTitle>
          <div className="catalog-reference-swatches">
            {COMMON_REFERENCE_COLORS.map(([label, token]) => (
              <div className="catalog-reference-swatch" key={token}>
                <span style={{ background: `var(${token})` }} aria-hidden="true" />
                <strong>{label}</strong>
                <code>{token}</code>
              </div>
            ))}
          </div>
        </SectionGroup>
        {REFERENCE_COLOR_FAMILIES.map(([label, family]) => (
          <SectionGroup key={family}>
            <SectionGroupTitle>{label}</SectionGroupTitle>
            <div className="catalog-reference-swatches">
              {REFERENCE_COLOR_STEPS.map((step) => {
                const token = `--ref-${family}-${step}`
                return (
                  <div className="catalog-reference-swatch" key={token}>
                    <span style={{ background: `var(${token})` }} aria-hidden="true" />
                    <strong>{step}</strong>
                    <code>{token}</code>
                  </div>
                )
              })}
            </div>
          </SectionGroup>
        ))}
      </SectionBody>
    </Section>
  )
}
