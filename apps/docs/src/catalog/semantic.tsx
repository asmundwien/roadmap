import { Section, SectionBody } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import semanticSource from '../../../../packages/ui/src/styles/semantic/README.md?raw'
import { Markdown } from './markdown'
import styles from './semantic.module.css'

const cx = classNames.bind(styles)

const SEMANTIC_SURFACE_PAIRS = [
  ['Surface', '--sys-color-surface', '--sys-color-on-surface'],
  ['Dim surface', '--sys-color-surface-dim', '--sys-color-on-surface'],
  ['Bright surface', '--sys-color-surface-bright', '--sys-color-on-surface'],
  ['Lowest container', '--sys-color-surface-container-lowest', '--sys-color-on-surface'],
  ['Low container', '--sys-color-surface-container-low', '--sys-color-on-surface'],
  ['Container', '--sys-color-surface-container', '--sys-color-on-surface'],
  ['High container', '--sys-color-surface-container-high', '--sys-color-on-surface'],
  ['Highest container', '--sys-color-surface-container-highest', '--sys-color-on-surface'],
  ['Inverse surface', '--sys-color-inverse-surface', '--sys-color-inverse-on-surface'],
] as const

const SEMANTIC_INTENTS = [
  ['Primary', 'primary'],
  ['Secondary', 'secondary'],
  ['Error', 'error'],
  ['Warning', 'warning'],
  ['Info', 'info'],
  ['Success', 'success'],
] as const

const SEMANTIC_SUPPORT_ROLES = [
  ['Outline', '--sys-color-outline', 'Visible boundaries and high-emphasis separators.'],
  ['Outline variant', '--sys-color-outline-variant', 'Low-emphasis boundaries and separators.'],
  ['Shadow', '--sys-color-shadow', 'The source color for elevation shadows.'],
  ['Scrim', '--sys-color-scrim', 'The source color for content-obscuring overlays.'],
] as const

export function SemanticPaletteCatalogSection() {
  return (
    <Section>
      <Markdown source={semanticSource} />

      <SectionBody>
        <Surface>
          <SurfaceTitle>Surfaces</SurfaceTitle>
          <SurfaceDescription>
            Surface roles establish elevation without naming a pigment. On-surface roles are the
            supported foregrounds for these backgrounds.
          </SurfaceDescription>
          <div className={cx('catalog-semantic-pairs')}>
            {SEMANTIC_SURFACE_PAIRS.map(([label, background, foreground]) => (
              <SemanticColorPair
                background={background}
                foreground={foreground}
                label={label}
                key={background}
              />
            ))}
          </div>
        </Surface>

        <Surface>
          <SurfaceTitle>Intents</SurfaceTitle>
          <SurfaceDescription>
            Each intent has a strong pair and a quieter container pair. An on-color role is valid
            only on its matching background role.
          </SurfaceDescription>
          <div className={cx('catalog-semantic-pairs')}>
            {SEMANTIC_INTENTS.flatMap(([label, intent]) => [
              <SemanticColorPair
                background={`--sys-color-${intent}`}
                foreground={`--sys-color-on-${intent}`}
                label={label}
                key={intent}
              />,
              <SemanticColorPair
                background={`--sys-color-${intent}-container`}
                foreground={`--sys-color-on-${intent}-container`}
                label={`${label} container`}
                key={`${intent}-container`}
              />,
            ])}
          </div>
        </Surface>

        <Surface>
          <SurfaceTitle>Supporting roles</SurfaceTitle>
          <div className={cx('catalog-semantic-support')}>
            {SEMANTIC_SUPPORT_ROLES.map(([label, token, description]) => (
              <div key={token}>
                <span style={{ backgroundColor: `var(${token})` }} aria-hidden="true" />
                <strong>{label}</strong>
                <code>{token}</code>
                <p>{description}</p>
              </div>
            ))}
          </div>
        </Surface>
      </SectionBody>
    </Section>
  )
}

type SemanticColorPairProps = {
  label: string
  background: string
  foreground: string
}

function SemanticColorPair({ label, background, foreground }: SemanticColorPairProps) {
  return (
    <div
      className={cx('catalog-semantic-pair')}
      style={{ backgroundColor: `var(${background})`, color: `var(${foreground})` }}
    >
      <strong>{label}</strong>
      <span>Foreground on background</span>
      <code>{foreground}</code>
      <code>{background}</code>
    </div>
  )
}
