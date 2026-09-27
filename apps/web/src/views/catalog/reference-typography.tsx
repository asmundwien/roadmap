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
const SIZES = [
  ['xs', 12],
  ['sm', 14],
  ['md', 16],
  ['lg', 18],
  ['xl', 20],
  ['2xl', 24],
  ['3xl', 30],
  ['jumbo', 48],
] as const
const WEIGHTS = [
  ['normal', 400],
  ['semibold', 600],
  ['bold', 700],
] as const
const LINE_HEIGHTS = [
  ['tight', 110],
  ['normal', 130],
  ['relaxed', 150],
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
            The labels name steps in the type scale. Pixel values assume a 16px root; rem units
            scale with the reader's root font setting.
          </SectionGroupDescription>
          <div className="catalog-reference-type-grid">
            {SIZES.map(([name, pixels]) => {
              const token = `--ref-font-size-${name}`
              return (
                <div className="catalog-reference-type-sample" key={token}>
                  <span style={{ fontSize: `var(${token})` }}>Aa Roadmap</span>
                  <strong>{pixels}px</strong>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Font weights</SectionGroupTitle>
          <SectionGroupDescription>
            Hold the size constant to compare normal (400), semibold (600), and bold (700).
          </SectionGroupDescription>
          <div className="catalog-reference-type-grid">
            {WEIGHTS.map(([name, weight]) => {
              const token = `--ref-font-weight-${name}`
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
            {LINE_HEIGHTS.map(([name, height]) => {
              const token = `--ref-line-height-${name}`
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
      </SectionBody>
    </Section>
  )
}
