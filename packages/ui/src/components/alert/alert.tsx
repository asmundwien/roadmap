import type { ReactNode } from 'react'
import './alert.css'

export type AlertVariant = 'error' | 'info'

type AlertProps = {
  children: ReactNode
  variant?: AlertVariant
}

export function Alert({ children, variant = 'error' }: AlertProps) {
  return (
    <div className={`alert alert-${variant}`} role={variant === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}
