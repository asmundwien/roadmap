import { PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionDescription, SectionHeader } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import styles from './reference-typography.module.css'

const cx = classNames.bind(styles)

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
        <PageTitle>Reference typography</PageTitle>
        <SectionDescription>
          Font values describe the type itself, not where it appears. Semantic type roles combine
          these values into titles, body copy, labels, and code.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <Surface>
          <SurfaceTitle>Font families</SurfaceTitle>
          <SurfaceDescription>
            Compare the system sans stack with the monospace stack using the same letters and
            digits.
          </SurfaceDescription>
          <div className={cx('catalog-reference-type-list')}>
            {FAMILIES.map(([label, token]) => (
              <div className={cx('catalog-reference-type-row')} key={token}>
                <strong>{label}</strong>
                <span style={{ fontFamily: `var(${token})` }}>Aa Wayfinder 0123</span>
                <code>{token}</code>
              </div>
            ))}
          </div>
        </Surface>
        <Surface>
          <SurfaceTitle>Font sizes</SurfaceTitle>
          <SurfaceDescription>
            The labels name steps in the type scale. Pixel values assume a 16px root; rem units
            scale with the reader's root font setting.
          </SurfaceDescription>
          <div className={cx('catalog-reference-type-list')}>
            {SIZES.map(([name, pixels]) => {
              const token = `--ref-font-size-${name}`
              return (
                <div className={cx('catalog-reference-type-row')} key={token}>
                  <strong>{pixels}px</strong>
                  <span style={{ fontSize: `var(${token})` }}>Aa Roadmap</span>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </Surface>
        <Surface>
          <SurfaceTitle>Font weights</SurfaceTitle>
          <SurfaceDescription>
            Hold the size constant to compare normal (400), semibold (600), and bold (700).
          </SurfaceDescription>
          <div className={cx('catalog-reference-type-list')}>
            {WEIGHTS.map(([name, weight]) => {
              const token = `--ref-font-weight-${name}`
              return (
                <div className={cx('catalog-reference-type-row')} key={token}>
                  <strong>{weight}</strong>
                  <span style={{ fontWeight: `var(${token})` }}>Aa Wayfinder</span>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </Surface>
        <Surface>
          <SurfaceTitle>Line heights</SurfaceTitle>
          <SurfaceDescription>
            Compare the distance between two baselines at one font size. These unitless multipliers
            follow the font size of their text.
          </SurfaceDescription>
          <div className={cx('catalog-reference-type-list')}>
            {LINE_HEIGHTS.map(([name, height]) => {
              const token = `--ref-line-height-${name}`
              return (
                <div className={cx('catalog-reference-type-row')} key={token}>
                  <strong>{height}%</strong>
                  <span style={{ lineHeight: `var(${token})` }}>
                    First line
                    <br />
                    Second line
                  </span>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </Surface>
      </SectionBody>
    </Section>
  )
}
