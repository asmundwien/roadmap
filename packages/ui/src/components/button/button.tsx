import classNames from 'classnames/bind'
import { type ButtonHTMLAttributes, Children, isValidElement, type ReactNode } from 'react'
import styles from './button.module.css'

const cx = classNames.bind(styles)

export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonAppearance = 'solid' | 'outline'

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  variant?: ButtonVariant
  appearance?: ButtonAppearance
  size?: 'small' | 'medium' | 'large'
}

export function Button({
  size = 'medium',
  variant = 'secondary',
  appearance = variant === 'primary' ? 'solid' : 'outline',
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={cx('button', variant, appearance, size)} {...props} />
}

type ButtonGroupProps = {
  children: ReactNode
  className?: string
}

export function ButtonGroup({ children, className }: ButtonGroupProps) {
  Children.forEach(children, (child) => {
    if (child != null && (!isValidElement(child) || child.type !== Button)) {
      throw new Error('ButtonGroup accepts only Button children')
    }
  })

  return <div className={cx('group', className)}>{children}</div>
}
