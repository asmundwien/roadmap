import type { ReactNode } from 'react'
import { Action, ActionGroup } from '@/components/action/action'
import { Alert } from '@/components/alert/alert'
import { AutomationMark } from '@/components/automation-mark/automation-mark'
import { Badge } from '@/components/badge/badge'
import { DestinationMark } from '@/components/destination-mark/destination-mark'
import {
  TicketMark,
  type TicketMarkCornerCount,
  type TicketMarkFill,
} from '@/components/ticket-mark/ticket-mark'
import type { Variant } from '@/components/variant'

const TICKET_MARK_FILLS = ['none', 'half', 'fill'] as const satisfies readonly TicketMarkFill[]
const TICKET_MARK_CORNERS = [0, 1, 2, 3, 4] as const satisfies readonly TicketMarkCornerCount[]
const TICKET_MARK_VARIANT_BY_FILL = {
  none: 'neutral',
  half: 'info',
  fill: 'success',
} as const satisfies Record<TicketMarkFill, Variant>
const TINY_MARK_VARIANTS = [
  'neutral',
  'accent',
  'warning',
  'danger',
  'success',
] as const satisfies readonly Variant[]
const TINY_MARK_GLYPH = {
  neutral: 'n',
  accent: 'a',
  warning: 'w',
  danger: 'd',
  success: 's',
} as const satisfies Record<(typeof TINY_MARK_VARIANTS)[number], string>
const TICKET_MARK_CORNER_GLYPHS = ['0', '1', '2', '3', '4'] as const

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

export function CatalogHeader() {
  return (
    <header className="component-catalog-head">
      <p className="component-catalog-eyebrow">UI inventory</p>
      <h1>Components</h1>
      <p className="muted">
        Shared marks, controls, and tokens. Each example uses the same classes and renderers as the
        product.
      </p>
    </header>
  )
}

export function ReferencePaletteCatalogSection() {
  return (
    <CatalogSection
      title="Reference layer"
      description="Literal color values without semantic or component meaning."
    >
      <div className="catalog-reference-palette">
        <div className="catalog-reference-family">
          <h3>Common</h3>
          <div className="catalog-reference-swatches">
            {COMMON_REFERENCE_COLORS.map(([label, token]) => (
              <div className="catalog-reference-swatch" key={token}>
                <span style={{ background: `var(${token})` }} aria-hidden="true" />
                <strong>{label}</strong>
                <code>{token}</code>
              </div>
            ))}
          </div>
        </div>
        {REFERENCE_COLOR_FAMILIES.map(([label, family]) => (
          <div className="catalog-reference-family" key={family}>
            <h3>{label}</h3>
            <div className="catalog-reference-swatches">
              {REFERENCE_COLOR_STEPS.map((step) => {
                const token = `--ref-${family}-${step}`
                return (
                  <div className="catalog-reference-swatch" key={token}>
                    <span style={{ background: `var(${token})` }} aria-hidden="true" />
                    <strong>{step}</strong>
                    <code>{token}</code>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </CatalogSection>
  )
}

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

export function TicketMarkCatalogSection() {
  return (
    <CatalogSection
      title="Ticket mark"
      description="A diamond mark with independent color, accent, fill, corner, content, and size controls. Rows show fill; columns show corner count."
    >
      <div className="catalog-mark-matrix">
        <span />
        {TICKET_MARK_CORNERS.map((cornerCount) => (
          <strong className="catalog-column-label" key={cornerCount}>
            {cornerCount} {cornerCount === 1 ? 'corner' : 'corners'}
          </strong>
        ))}
        {TICKET_MARK_FILLS.map((fill) => (
          <TicketMarkRow fill={fill} key={fill} />
        ))}
      </div>
    </CatalogSection>
  )
}

export function TinyTicketMarksCatalogSection() {
  return (
    <CatalogSection
      title="Tiny ticket marks"
      description="The tiny size fits inline text and omits content."
    >
      <div className="catalog-tiny-marks">
        {TINY_MARK_VARIANTS.map((variant) => (
          <Badge variant={variant} key={variant}>
            <TicketMark accent={variant} cornerCount={0} fill="fill" size="tiny" variant={variant}>
              {TINY_MARK_GLYPH[variant]}
            </TicketMark>
            {TINY_MARK_GLYPH[variant].toUpperCase()}
            {variant.slice(1)}
          </Badge>
        ))}
      </div>
    </CatalogSection>
  )
}

export function BadgesCatalogSection() {
  return (
    <CatalogSection
      title="Badges"
      description="Short labels and inline content use a shared shape with semantic color variants."
    >
      <div className="catalog-badges">
        <Badge>Neutral</Badge>
        <Badge variant="accent">Accent</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="danger">Danger</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="muted">Muted</Badge>
      </div>
    </CatalogSection>
  )
}

export function RoadmapSignalsCatalogSection() {
  return (
    <CatalogSection
      title="Roadmap signals"
      description="Product state and Automation evidence remain separate visual facts."
    >
      <div className="catalog-signals">
        <Signal label="Destination">
          <DestinationMark variant="plot" x={24} y={24} />
        </Signal>
        <Signal label="Classification">
          <AutomationMark variant="plot" stage="classification" glyph="C" x={24} y={24} />
        </Signal>
        <Signal label="Wayfinder">
          <AutomationMark variant="plot" stage="wayfinder" glyph="W" x={24} y={24} />
        </Signal>
      </div>
    </CatalogSection>
  )
}

export function ControlsCatalogSection() {
  return (
    <CatalogSection
      title="Controls"
      description="Default, emphasized, destructive, and unavailable states."
    >
      <div className="catalog-control-groups">
        <div className="catalog-control-group">
          <span className="catalog-control-label">Actions</span>
          <ActionGroup>
            <Action type="button">Default</Action>
            <Action variant="strong" type="button">
              Emphasized
            </Action>
            <Action variant="danger" type="button">
              Destructive
            </Action>
            <Action type="button" disabled>
              Unavailable
            </Action>
          </ActionGroup>
        </div>
        <div className="catalog-control-group">
          <span className="catalog-control-label">Messages</span>
          <Alert>
            <strong>Action required.</strong>
            <span>The operation stays blocked until the problem is fixed.</span>
          </Alert>
          <Alert variant="info">
            <strong>Change saved.</strong>
            <span>The new configuration is active.</span>
          </Alert>
        </div>
      </div>
    </CatalogSection>
  )
}

type CatalogSectionProps = {
  title: string
  description: string
  children?: ReactNode
}

function CatalogSection({ title, description, children }: CatalogSectionProps) {
  return (
    <section className="catalog-section">
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
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

type TicketMarkRowProps = { fill: TicketMarkFill }

function TicketMarkRow({ fill }: TicketMarkRowProps) {
  const variant = TICKET_MARK_VARIANT_BY_FILL[fill]

  return (
    <>
      <strong className="catalog-row-label">{fill}</strong>
      {TICKET_MARK_CORNERS.map((cornerCount) => (
        <svg
          className="catalog-ticket-mark"
          viewBox="-24 -24 48 48"
          aria-label={`${fill} fill with ${cornerCount} ${cornerCount === 1 ? 'corner' : 'corners'}`}
          key={cornerCount}
        >
          <TicketMark
            accent="warning"
            cornerCount={cornerCount}
            fill={fill}
            size="major"
            variant={variant}
            x={0}
            y={0}
          >
            {TICKET_MARK_CORNER_GLYPHS[cornerCount]}
          </TicketMark>
        </svg>
      ))}
    </>
  )
}

type SignalProps = { label: string; children: ReactNode }

function Signal({ label, children }: SignalProps) {
  return (
    <div className="catalog-signal">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {children}
      </svg>
      <span>{label}</span>
    </div>
  )
}
