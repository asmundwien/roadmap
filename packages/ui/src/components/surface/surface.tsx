import cn from 'classnames'
import classNames from 'classnames/bind'
import type { HTMLAttributes } from 'react'
import styles from './surface.module.css'

const cx = classNames.bind(styles)

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  /** Defaults to `default`. Use `subtle` for supporting content, `emphasized` for attention, or `danger` for destructive content. */
  variant?: 'subtle' | 'default' | 'emphasized' | 'danger'
}

/** A bordered grid container for grouped content. Caller classes are merged with its styles. */
export function Surface({ className, variant = 'default', ...props }: SurfaceProps) {
  return <div className={cn(cx('surface', variant), className)} {...props} />
}

/** Renders an `h3`; use where that rank fits the document's heading hierarchy. */
export function SurfaceTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn(cx('title'), className)} {...props} />
}

/** Renders supporting text as a paragraph inside a surface. */
export function SurfaceDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn(cx('description'), className)} {...props} />
}
