import classNames from 'classnames/bind'
import type { ReactNode } from 'react'
import styles from './alert.module.css'

const cx = classNames.bind(styles)

type AlertProps = {
  children: ReactNode
  /** Defaults to error, which has `role="alert"`; info has no alert role. */
  variant?: 'error' | 'info'
}

/** A message box without outer margin; its parent controls surrounding spacing. */
export function Alert({ children, variant = 'error' }: AlertProps) {
  return (
    <div className={cx('alert', variant)} role={variant === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}
