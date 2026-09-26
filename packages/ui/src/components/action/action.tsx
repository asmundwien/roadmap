import classNames from 'classnames/bind'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './action.module.css'

const cx = classNames.bind(styles)

export type ActionVariant = 'default' | 'strong' | 'danger'

type ActionPresentation = {
  variant?: ActionVariant
  size?: 'default' | 'field'
}

type ButtonActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> &
  ActionPresentation & {
    element?: 'button'
  }

type LinkActionProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> &
  ActionPresentation & {
    element: 'link'
  }

export type ActionProps = ButtonActionProps | LinkActionProps

/** A button or link with the shared action treatment. The element prop preserves native semantics. */
export function Action(props: ActionProps) {
  if (props.element === 'link') {
    const { element: _element, size = 'default', variant = 'default', ...linkProps } = props
    return <a className={actionClass(variant, size)} {...linkProps} />
  }

  const {
    element: _element,
    size = 'default',
    variant = 'default',
    type = 'button',
    ...buttonProps
  } = props
  return <button type={type} className={actionClass(variant, size)} {...buttonProps} />
}

/** The default variant and size are the base treatment, so neither adds a class of its own. */
function actionClass(variant: ActionVariant, size: 'default' | 'field'): string {
  return cx('action', variant !== 'default' && variant, size === 'field' && 'field')
}

type ActionGroupProps = {
  children: ReactNode
  variant?: 'default' | 'form' | 'connection'
}

export function ActionGroup({ children, variant = 'default' }: ActionGroupProps) {
  return <div className={cx('group', variant !== 'default' && `group-${variant}`)}>{children}</div>
}
