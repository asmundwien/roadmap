export type Variant =
  | 'neutral'
  | 'accent'
  | 'highlight'
  | 'warning'
  | 'danger'
  | 'success'
  | 'info'
  | 'muted'

/** The semantic role each variant resolves to, for SVG attributes that cannot take a class. */
export const VARIANT_COLORS = {
  neutral: 'var(--sys-color-on-surface-variant)',
  accent: 'var(--sys-color-primary)',
  highlight: 'var(--sys-color-secondary)',
  warning: 'var(--sys-color-warning)',
  danger: 'var(--sys-color-error)',
  success: 'var(--sys-color-success)',
  info: 'var(--sys-color-info)',
  muted: 'var(--sys-color-outline)',
} as const satisfies Record<Variant, string>
