import classNames from 'classnames/bind'
import { type ButtonHTMLAttributes, Children, isValidElement, type ReactNode } from 'react'
import styles from './button.module.css'

const cx = classNames.bind(styles)

export type ButtonVariant = 'default' | 'strong' | 'danger'

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  variant?: ButtonVariant
  size?: 'default' | 'field'
}

export function Button({
  size = 'default',
  variant = 'default',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('button', variant !== 'default' && variant, size === 'field' && 'field')}
      {...props}
    />
  )
}

type ButtonGroupProps = {
  children: ReactNode
  variant?: 'default' | 'form' | 'connection'
}

export function ButtonGroup({ children, variant = 'default' }: ButtonGroupProps) {
  Children.forEach(children, (child) => {
    if (child != null && (!isValidElement(child) || child.type !== Button)) {
      throw new Error('ButtonGroup accepts only Button children')
    }
  })

  return <div className={cx('group', variant !== 'default' && `group-${variant}`)}>{children}</div>
}
