import type { ReactNode } from 'react'
import './alert.css'

export type AlertVariant = 'error' | 'info'

export function Alert({
  children,
  variant = 'error',
}: {
  children: ReactNode
  variant?: AlertVariant
}) {
  return (
    <div className={`alert alert-${variant}`} role={variant === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}
