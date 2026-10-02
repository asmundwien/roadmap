import { PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionDescription, SectionHeader } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import styles from './reference-motion.module.css'

const cx = classNames.bind(styles)

const DURATIONS = [
  ['150ms', '--ref-duration-150'],
  ['300ms', '--ref-duration-300'],
] as const

export function ReferenceMotionCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <PageTitle>Reference motion</PageTitle>
        <SectionDescription>
          Durations and easing curves describe movement, not an interaction. Semantic motion tokens
          choose which transition uses them. The samples stay still when reduced motion is
          preferred.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <Surface>
          <SurfaceTitle>Durations</SurfaceTitle>
          <SurfaceDescription>
            Hover or focus the comparison to move both markers the same distance. The short marker
            finishes in half the time of the medium one.
          </SurfaceDescription>
          <div className={cx('catalog-reference-motion-demo')}>
            <button type="button">Compare durations</button>
            {DURATIONS.map(([label, token]) => (
              <div className={cx('catalog-reference-motion-row')} key={token}>
                <strong>{label}</strong>
                <span className={cx('catalog-reference-motion-track')}>
                  <span
                    className={cx('catalog-reference-motion-marker')}
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
        </Surface>
        <Surface>
          <SurfaceTitle>Easing</SurfaceTitle>
          <SurfaceDescription>
            Both markers take 300ms. Linear moves at a constant speed; the standard curve changes
            speed as it approaches the end. Linear is a comparison, not a reference token.
          </SurfaceDescription>
          <div className={cx('catalog-reference-motion-demo')}>
            <button type="button">Compare easing</button>
            <div className={cx('catalog-reference-motion-row')}>
              <strong>Linear</strong>
              <span className={cx('catalog-reference-motion-track')}>
                <span
                  className={cx('catalog-reference-motion-marker')}
                  style={{
                    transitionDuration: 'var(--ref-duration-300)',
                    transitionTimingFunction: 'linear',
                  }}
                />
              </span>
              <code>linear (baseline)</code>
            </div>
            <div className={cx('catalog-reference-motion-row')}>
              <strong>Standard</strong>
              <span className={cx('catalog-reference-motion-track')}>
                <span
                  className={cx('catalog-reference-motion-marker')}
                  style={{
                    transitionDuration: 'var(--ref-duration-300)',
                    transitionTimingFunction: 'var(--ref-easing-standard)',
                  }}
                />
              </span>
              <code>--ref-easing-standard</code>
            </div>
          </div>
        </Surface>
      </SectionBody>
    </Section>
  )
}
