import classNames from 'classnames/bind'
import type { ReactNode } from 'react'
import type { Variant } from '../variant'
import styles from './badge.module.css'

const cx = classNames.bind(styles)

export type BadgeProps = {
  children: ReactNode
  variant?: Variant
}

export function Badge({ children, variant = 'neutral' }: BadgeProps) {
  return <span className={cx('badge', variant)}>{children}</span>
}
