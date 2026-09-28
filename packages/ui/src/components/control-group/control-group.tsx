import classNames from 'classnames/bind'
import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import { Button, type ButtonProps } from '../button/button'
import { TextInput, type TextInputProps } from '../text-input/text-input'
import styles from './control-group.module.css'

const cx = classNames.bind(styles)

/** Props for a grouped row of buttons and text inputs. */
type ControlGroupProps = {
  /** Direct `Button` and `TextInput` children only; other non-null children throw. */
  children?: ReactNode
  className?: string
  /** Overrides each child's own size. Defaults to `medium`. */
  size?: NonNullable<ButtonProps['size']>
}

/** Renders adjacent controls as one group, applying the same size to every child. */
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
