import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import styles from './reference-colors.module.css'

const cx = classNames.bind(styles)

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

export function ReferenceColorsPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Reference colors</PageTitle>
        <PageDescription>
          Literal pigments, not foreground and background pairs. The ramps run from 50 (lightest) to
          950 (darkest); a step alone does not promise readable text. Product styles use semantic
          roles so contrast and dark mode can change independently.
        </PageDescription>
      </PageHeader>

      <Surface>
        <SurfaceTitle>Common</SurfaceTitle>
        <SurfaceDescription>
          White and black sit outside the tonal ramps. Their names describe the pigment, not a
          surface or text role.
        </SurfaceDescription>
        <div className={cx('reference-swatches')}>
          {COMMON_REFERENCE_COLORS.map(([label, token]) => (
            <div className={cx('reference-swatch')} key={token}>
              <span style={{ background: `var(${token})` }} aria-hidden="true" />
              <strong>{label}</strong>
              <code>{token}</code>
            </div>
          ))}
        </div>
      </Surface>
      {REFERENCE_COLOR_FAMILIES.map(([label, family]) => (
        <Surface key={family}>
          <SurfaceTitle>{label}</SurfaceTitle>
          <div className={cx('reference-swatches')}>
            {REFERENCE_COLOR_STEPS.map((step) => {
              const token = `--ref-${family}-${step}`
              return (
                <div className={cx('reference-swatch')} key={token}>
                  <span style={{ background: `var(${token})` }} aria-hidden="true" />
                  <strong>{step}</strong>
                  <code>{token}</code>
                </div>
              )
            })}
          </div>
        </Surface>
      ))}
    </>
  )
}
