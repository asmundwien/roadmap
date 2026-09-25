import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import './action.css'

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
    return <a className={actionClassName(variant, size)} {...linkProps} />
  }

  const {
    element: _element,
    size = 'default',
    variant = 'default',
    type = 'button',
    ...buttonProps
  } = props
  return <button type={type} className={actionClassName(variant, size)} {...buttonProps} />
}

export function ActionGroup({
  children,
  variant = 'default',
}: {
  children: ReactNode
  variant?: 'default' | 'form' | 'connection'
}) {
  return <div className={`action-group action-group-${variant}`}>{children}</div>
}

function actionClassName(variant: ActionVariant, size: ActionPresentation['size']): string {
  return `action action-${variant}${size === 'field' ? ' action-field' : ''}`
}
