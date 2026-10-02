import classNames from 'classnames/bind'
import type { ReactNode } from 'react'
import styles from './component-examples.module.css'

const cx = classNames.bind(styles)

type ComponentExamplesProps = {
  children: ReactNode
}

export function ComponentExamples({ children }: ComponentExamplesProps) {
  return <div className={cx('component-examples')}>{children}</div>
}

export function ComponentExample({ children }: ComponentExamplesProps) {
  return <div className={cx('component-example')}>{children}</div>
}
