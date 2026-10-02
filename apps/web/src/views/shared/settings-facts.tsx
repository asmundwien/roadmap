import cn from 'classnames'
import classNames from 'classnames/bind'
import type { ComponentProps } from 'react'
import styles from './settings-facts.module.css'

const cx = classNames.bind(styles)

type SettingsFactsProps = ComponentProps<'dl'>

export function SettingsFacts({ className, ...props }: SettingsFactsProps) {
  return <dl {...props} className={cn(cx('facts'), className)} />
}
