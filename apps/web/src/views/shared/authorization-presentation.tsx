import classNames from 'classnames/bind'
import type { ReactNode } from 'react'
import styles from './authorization-presentation.module.css'

const cx = classNames.bind(styles)

type AuthorizationPresentationProps = {
  children: ReactNode
}

export function DeviceCode({ children }: AuthorizationPresentationProps) {
  return <div className={cx('device-code')}>{children}</div>
}

export function AuthorizationControls({ children }: AuthorizationPresentationProps) {
  return <div className={cx('authorization-controls')}>{children}</div>
}
