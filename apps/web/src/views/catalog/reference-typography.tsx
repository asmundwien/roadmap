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
import './reference-typography.css'

const FAMILIES = [
  ['Sans', '--ref-font-family-sans'],
  ['Mono', '--ref-font-family-mono'],
] as const
const SIZES = [11, 13, 16, 32] as const
const WEIGHTS = [400, 500, 600, 700, 900] as const
const LINE_HEIGHTS = [110, 130, 150] as const
const TRACKING = [
  ['Tight', '--ref-letter-spacing-tight'],
  ['Wide', '--ref-letter-spacing-wide'],
] as const

export function ReferenceTypographyCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Reference typography</SectionTitle>
        <SectionDescription>
          Font values describe the type itself, not where it appears. Semantic type roles combine
          these values into titles, body copy, labels, and code.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <SectionGroup>
          <SectionGroupTitle>Font families</SectionGroupTitle>
          <SectionGroupDescription>
            Compare the system sans stack with the monospace stack using the same letters and
            digits.
          </SectionGroupDescription>
          <div className="catalog-reference-type-grid">
            {FAMILIES.map(([label, token]) => (
              <div className="catalog-reference-type-sample" key={token}>
                <span style={{ fontFamily: `var(${token})` }}>Aa Wayfinder 0123</span>
                <strong>{label}</strong>
                <code>{token}</code>
              </div>
            ))}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Font sizes</SectionGroupTitle>
          <SectionGroupDescription>
            The number is the pixel size at a 16px root. Rem units let the sample grow with the
            reader's root font setting.
          </SectionGroupDescription>
          <div className="catalog-reference-type-grid">
            {SIZES.map((size) => {
              const token = `--ref-font-size-${size}`
              return (
                <div className="catalog-reference-type-sample" key={token}>
                  <span style={{ fontSize: `var(${token})` }}>Aa Roadmap</span>
                  <strong>{size}px</strong>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Font weights</SectionGroupTitle>
          <SectionGroupDescription>
            Hold the size constant to compare strokes from regular (400) to black (900).
          </SectionGroupDescription>
          <div className="catalog-reference-type-grid">
            {WEIGHTS.map((weight) => {
              const token = `--ref-font-weight-${weight}`
              return (
                <div className="catalog-reference-type-sample" key={token}>
                  <span style={{ fontWeight: `var(${token})` }}>Aa Wayfinder</span>
                  <strong>{weight}</strong>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Line heights</SectionGroupTitle>
          <SectionGroupDescription>
            Compare the distance between two baselines at one font size. These unitless multipliers
            follow the font size of their text.
          </SectionGroupDescription>
          <div className="catalog-reference-type-grid">
            {LINE_HEIGHTS.map((height) => {
              const token = `--ref-line-height-${height}`
              return (
                <div className="catalog-reference-type-sample" key={token}>
                  <span style={{ lineHeight: `var(${token})` }}>
                    First line
                    <br />
                    Second line
                  </span>
                  <strong>{height}%</strong>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Letter spacing</SectionGroupTitle>
          <SectionGroupDescription>
            Tight closes the gaps; wide opens them. Em units scale the spacing with the letters.
          </SectionGroupDescription>
          <div className="catalog-reference-type-grid">
            {TRACKING.map(([label, token]) => (
              <div className="catalog-reference-type-sample" key={token}>
                <span style={{ letterSpacing: `var(${token})` }}>MAP LABEL</span>
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
