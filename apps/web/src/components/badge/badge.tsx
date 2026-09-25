import type { ReactNode } from 'react'
import type { Variant } from '../variant.ts'
import './badge.css'

export type BadgeProps = {
  children: ReactNode
  variant?: Variant
}

export function Badge({ children, variant = 'neutral' }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}
