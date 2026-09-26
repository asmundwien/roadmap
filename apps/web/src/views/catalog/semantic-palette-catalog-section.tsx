import { CatalogSection } from './catalog-section'
import './semantic-palette-catalog-section.css'

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
    <CatalogSection
      title="Semantic role layer"
      description="System tokens name a color's purpose. Components consume these roles; only this layer refers to reference colors."
    >
      <div className="catalog-semantic-palette">
        <div className="catalog-semantic-group">
          <h3>Surfaces</h3>
          <p>
            Surface roles establish elevation without naming a pigment. On-surface roles are the
            supported foregrounds for these backgrounds.
          </p>
          <div className="catalog-semantic-pairs">
            {SEMANTIC_SURFACE_PAIRS.map(([label, background, foreground]) => (
              <SemanticColorPair
                background={background}
                foreground={foreground}
                label={label}
                key={background}
              />
            ))}
          </div>
        </div>

        <div className="catalog-semantic-group">
          <h3>Intents</h3>
          <p>
            Each intent has a strong pair and a quieter container pair. An on-color role is valid
            only on its matching background role.
          </p>
          <div className="catalog-semantic-pairs">
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
        </div>

        <div className="catalog-semantic-group">
          <h3>Supporting roles</h3>
          <div className="catalog-semantic-support">
            {SEMANTIC_SUPPORT_ROLES.map(([label, token, description]) => (
              <div key={token}>
                <span style={{ backgroundColor: `var(${token})` }} aria-hidden="true" />
                <strong>{label}</strong>
                <code>{token}</code>
                <p>{description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CatalogSection>
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
      className="catalog-semantic-pair"
      style={{ backgroundColor: `var(${background})`, color: `var(${foreground})` }}
    >
      <strong>{label}</strong>
      <span>Foreground on background</span>
      <code>{foreground}</code>
      <code>{background}</code>
    </div>
  )
}
