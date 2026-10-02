import { ControlGroup } from '@roadmap/ui/control-group'
import cn from 'classnames'
import classNames from 'classnames/bind'
import type { ComponentProps } from 'react'
import styles from './settings-form-actions.module.css'

const cx = classNames.bind(styles)

type SettingsFormActionsProps = ComponentProps<typeof ControlGroup>

export function SettingsFormActions({ className, ...props }: SettingsFormActionsProps) {
  return <ControlGroup {...props} className={cn(cx('actions'), className)} />
}
