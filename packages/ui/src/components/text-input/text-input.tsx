import classNames from 'classnames/bind'
import type { InputHTMLAttributes } from 'react'
import styles from './text-input.module.css'

const cx = classNames.bind(styles)

export type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className' | 'size'
> & {
  size?: 'small' | 'medium' | 'large'
}

export function TextInput({ size = 'medium', ...props }: TextInputProps) {
  return <input {...props} type="text" className={cx('input', size)} />
}
