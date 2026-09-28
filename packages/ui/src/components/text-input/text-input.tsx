import classNames from 'classnames/bind'
import type { InputHTMLAttributes } from 'react'
import styles from './text-input.module.css'

const cx = classNames.bind(styles)

/** Native input props for a text-only field; `type`, native `size`, and `className` cannot be set. */
export type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className' | 'size'
> & {
  /** Control height and padding. Defaults to `medium`. */
  size?: 'small' | 'medium' | 'large'
}

/** Renders a styled native text input and forwards supported input attributes and callbacks. */
export function TextInput({ size = 'medium', ...props }: TextInputProps) {
  return <input {...props} type="text" className={cx('input', size)} />
}
