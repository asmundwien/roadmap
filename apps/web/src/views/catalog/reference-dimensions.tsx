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

const SPACES = [0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64] as const
const CONTROL_SIZES = [32, 36, 40] as const
const LAYOUT_SIZES = [256, 640, 768, 1200] as const
const BORDER_WIDTHS = [1, 3] as const
const RADII = [
  ['Square', '--ref-radius-0'],
  ['Round', '--ref-radius-full'],
] as const

export function ReferenceDimensionsCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Reference dimensions</SectionTitle>
        <SectionDescription>
          Literal spacing and geometry have no layout or component role. Semantic size tokens assign
          these measurements to gaps, controls, and content widths.
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
            {SPACES.map((space) => {
              const token = `--ref-space-${space}`
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
          <SectionGroupTitle>Control heights</SectionGroupTitle>
          <SectionGroupDescription>
            Compare the three fixed control heights on one baseline. These are measurements, not
            button or field styles.
          </SectionGroupDescription>
          <div className="catalog-reference-control-sizes">
            {CONTROL_SIZES.map((size) => {
              const token = `--ref-size-${size}`
              return (
                <div className="catalog-reference-control-size" key={token}>
                  <span style={{ height: `var(${token})` }} aria-hidden="true" />
                  <strong>{size}px</strong>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Layout widths</SectionGroupTitle>
          <SectionGroupDescription>
            Scroll horizontally to compare the full widths on one scale. These are maximum content
            measurements, not responsive breakpoints.
          </SectionGroupDescription>
          <div className="catalog-reference-layout-widths">
            {LAYOUT_SIZES.map((size) => {
              const token = `--ref-size-${size}`
              return (
                <div className="catalog-reference-layout-width" key={token}>
                  <span style={{ width: `var(${token})` }} aria-hidden="true" />
                  <strong>{size}px</strong>
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
            {BORDER_WIDTHS.map((width) => {
              const token = `--ref-border-width-${width}`
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
