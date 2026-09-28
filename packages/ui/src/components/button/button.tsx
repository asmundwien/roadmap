import classNames from 'classnames/bind'
import type { ButtonHTMLAttributes } from 'react'
import styles from './button.module.css'

const cx = classNames.bind(styles)

/** Native button props with design-system styles; custom `className` is not supported. */
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  /** Color intent. Defaults to `secondary`. */
  variant?: 'primary' | 'secondary' | 'danger'
  /** Defaults to `solid` for primary buttons and `outline` otherwise. */
  appearance?: 'solid' | 'outline'
  /** Control height and padding. Defaults to `medium`. */
  size?: 'small' | 'medium' | 'large'
}

/** Renders a styled native button. Its HTML `type` defaults to `button` to avoid implicit form submission. */
export function Button({
  size = 'medium',
  variant = 'secondary',
  appearance = variant === 'primary' ? 'solid' : 'outline',
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={cx('button', variant, appearance, size)} {...props} />
}
