import classNames from 'classnames/bind'
import type { ReactNode } from 'react'
import styles from './alert.module.css'

const cx = classNames.bind(styles)

export type AlertVariant = 'error' | 'info'

type AlertProps = {
  children: ReactNode
  variant?: AlertVariant
}

export function Alert({ children, variant = 'error' }: AlertProps) {
  return (
    <div className={cx('alert', variant)} role={variant === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}
