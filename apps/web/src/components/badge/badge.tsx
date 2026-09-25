import type { ReactNode } from 'react'
import './badge.css'

export type BadgeVariant =
  | 'neutral'
  | 'accent'
  | 'warning'
  | 'danger'
  | 'success'
  | 'info'
  | 'muted'
  | 'violet'
  | 'teal'

export type BadgeProps = {
  children: ReactNode
  variant?: BadgeVariant
}

export function Badge({ children, variant = 'neutral' }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}
