import cn from 'classnames'
import classNames from 'classnames/bind'
import type { HTMLAttributes } from 'react'
import styles from './surface.module.css'

const cx = classNames.bind(styles)

export type SurfaceVariant = 'subtle' | 'default' | 'emphasized' | 'danger'

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  variant?: SurfaceVariant
}

export function Surface({ className, variant = 'default', ...props }: SurfaceProps) {
  return <div className={cn(cx('surface', variant), className)} {...props} />
}

export type SurfaceTitleProps = HTMLAttributes<HTMLHeadingElement>

/** Use where an h3 is the appropriate heading rank; standalone surfaces can use their own heading. */
export function SurfaceTitle({ className, ...props }: SurfaceTitleProps) {
  return <h3 className={cn(cx('title'), className)} {...props} />
}

export type SurfaceDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export function SurfaceDescription({ className, ...props }: SurfaceDescriptionProps) {
  return <p className={cn(cx('description'), className)} {...props} />
}
