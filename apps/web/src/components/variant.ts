export type Variant =
  | 'neutral'
  | 'accent'
  | 'warning'
  | 'danger'
  | 'success'
  | 'info'
  | 'muted'
  | 'violet'
  | 'teal'

export const VARIANT_COLORS = {
  neutral: 'var(--variant-neutral)',
  accent: 'var(--variant-accent)',
  warning: 'var(--variant-warning)',
  danger: 'var(--variant-danger)',
  success: 'var(--variant-success)',
  info: 'var(--variant-info)',
  muted: 'var(--variant-muted)',
  violet: 'var(--variant-violet)',
  teal: 'var(--variant-teal)',
} as const satisfies Record<Variant, string>
