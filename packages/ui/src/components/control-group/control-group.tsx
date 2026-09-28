import classNames from 'classnames/bind'
import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import { Button, type ButtonProps } from '../button/button'
import { TextInput, type TextInputProps } from '../text-input/text-input'
import styles from './control-group.module.css'

const cx = classNames.bind(styles)

type ControlGroupProps = {
  children?: ReactNode
  className?: string
  size?: NonNullable<ButtonProps['size']>
}

export function ControlGroup({ children, className, size = 'medium' }: ControlGroupProps) {
  const controls = Children.map(children, (child) => {
    if (child == null) return null
    if (
      !isValidElement<ButtonProps | TextInputProps>(child) ||
      (child.type !== Button && child.type !== TextInput)
    ) {
      throw new Error('ControlGroup accepts only Button and TextInput children')
    }
    return cloneElement(child, { size })
  })

  return <div className={cx('group', className)}>{controls}</div>
}
