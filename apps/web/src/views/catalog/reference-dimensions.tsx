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
import './reference-dimensions.css'

const SPACES = [
  ['none', 0],
  ['3xs', 2],
  ['2xs', 4],
  ['xs', 8],
  ['sm', 12],
  ['md', 16],
  ['lg', 24],
  ['xl', 32],
  ['2xl', 40],
  ['3xl', 48],
  ['4xl', 64],
] as const
const BORDER_WIDTHS = [
  ['sm', 1],
  ['lg', 3],
] as const
const RADII = [
  ['Square', '--ref-radius-none'],
  ['Round', '--ref-radius-full'],
] as const

export function ReferenceDimensionsCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Reference dimensions</SectionTitle>
        <SectionDescription>
          Reference spacing and geometry have no layout or component role. Semantic tokens assign
          these measurements to gaps, border weights, and corner shapes.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <SectionGroup>
          <SectionGroupTitle>Spacing ladder</SectionGroupTitle>
          <SectionGroupDescription>
            Each bar starts at the same edge. The numbers resolve to pixels at a 16px root; rem
            keeps gaps and padding proportional when the root font size changes.
          </SectionGroupDescription>
          <div className="catalog-reference-dimension-list">
            {SPACES.map(([name, space]) => {
              const token = `--ref-space-${name}`
              return (
                <div className="catalog-reference-dimension-row" key={token}>
                  <strong>{space}px</strong>
                  <div className="catalog-reference-space-track">
                    <span style={{ width: `var(${token})` }} />
                  </div>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Border widths</SectionGroupTitle>
          <SectionGroupDescription>
            A one-pixel hairline and a three-pixel edge outline the same shape. The tokens specify
            thickness only, not color.
          </SectionGroupDescription>
          <div className="catalog-reference-dimension-pairs">
            {BORDER_WIDTHS.map(([name, width]) => {
              const token = `--ref-border-width-${name}`
              return (
                <div className="catalog-reference-border-sample" key={token}>
                  <span style={{ borderWidth: `var(${token})` }} aria-hidden="true" />
                  <strong>{width}px</strong>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Corner radii</SectionGroupTitle>
          <SectionGroupDescription>
            Zero keeps a square corner; full rounds a fixed square into a circle. Radius does not
            select a component shape by itself.
          </SectionGroupDescription>
          <div className="catalog-reference-dimension-pairs">
            {RADII.map(([label, token]) => (
              <div className="catalog-reference-radius-sample" key={token}>
                <span style={{ borderRadius: `var(${token})` }} aria-hidden="true" />
                <strong>{label}</strong>
                <code>{token}</code>
              </div>
            ))}
          </div>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
