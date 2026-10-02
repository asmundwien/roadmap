import cn from 'classnames'
import classNames from 'classnames/bind'
import type { ComponentProps } from 'react'
import styles from './settings-form.module.css'

const cx = classNames.bind(styles)

type SettingsFormProps = ComponentProps<'form'>

export function SettingsForm({ className, ...props }: SettingsFormProps) {
  return <form {...props} className={cn(cx('form'), className)} />
}
