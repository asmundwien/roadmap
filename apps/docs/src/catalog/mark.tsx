import { Mark, type MarkCornerCount, type MarkFill, type MarkSize } from '@roadmap/ui/mark'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import type { Variant } from '@roadmap/ui/variant'
import classNames from 'classnames/bind'
import type { ReactNode } from 'react'
import styles from './mark.module.css'

const cx = classNames.bind(styles)
const MARK_FILLS = ['solid', 'half', 'outline'] as const satisfies readonly MarkFill[]
const MARK_CORNER_COUNTS = [0, 1, 2, 3, 4] as const satisfies readonly MarkCornerCount[]
const MARK_SIZES = ['large', 'medium', 'small'] as const satisfies readonly MarkSize[]
const MARK_VARIANTS = [
  'neutral',
  'accent',
  'highlight',
  'warning',
  'danger',
  'success',
  'info',
  'muted',
] as const satisfies readonly Variant[]
export function MarkCatalogPage() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Mark</SectionTitle>
        <SectionDescription>
          A decorative diamond with no domain meaning. The caller picks fill, glyph, corner count,
          and color. Solid faces knock out the glyph; other fills draw it with a surface halo.
          Consumers own placement through HTML layout or a translated SVG wrapper. The mark is
          hidden from assistive technology; convey its meaning in adjacent text or the containing
          control's accessible name.
        </SectionDescription>
      </SectionHeader>

      <SectionBody>
        <MarkGroup label="Fill">
          {MARK_FILLS.map((fill) => (
            <MarkCell caption={fill} key={fill}>
              <Mark fill={fill} glyph="T" size="large" variant="info" />
            </MarkCell>
          ))}
        </MarkGroup>
        <MarkGroup label="Corners">
          {MARK_CORNER_COUNTS.map((corners) => (
            <MarkCell caption={String(corners)} key={corners}>
              <Mark accent="accent" corners={corners} fill="outline" size="large" variant="muted" />
            </MarkCell>
          ))}
        </MarkGroup>
        <MarkGroup label="Size">
          {MARK_SIZES.map((size) => (
            <MarkCell caption={size} key={size}>
              <Mark fill="solid" glyph="T" size={size} variant="info" />
            </MarkCell>
          ))}
        </MarkGroup>
        <MarkGroup label="Variant">
          {MARK_VARIANTS.map((variant) => (
            <MarkCell caption={variant} key={variant}>
              <Mark fill="solid" size="large" variant={variant} />
            </MarkCell>
          ))}
        </MarkGroup>
      </SectionBody>
    </Section>
  )
}
type MarkGroupProps = { label: string; children: ReactNode }

function MarkGroup({ label, children }: MarkGroupProps) {
  return (
    <Surface>
      <SurfaceTitle>{label}</SurfaceTitle>
      <div className={cx('catalog-mark-row')}>{children}</div>
    </Surface>
  )
}

type MarkCellProps = { caption: string; children: ReactNode }

function MarkCell({ caption, children }: MarkCellProps) {
  return (
    <div className={cx('catalog-mark-cell')}>
      {children}
      <code>{caption}</code>
    </div>
  )
}
