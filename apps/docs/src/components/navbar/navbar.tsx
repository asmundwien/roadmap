import cn from 'classnames'
import classNames from 'classnames/bind'
import type { AnchorHTMLAttributes, HTMLAttributes } from 'react'
import styles from './navbar.module.css'

const cx = classNames.bind(styles)

/**
 * Renders a top-level header with wrapping, spaced content and a bottom border.
 * Compose its children freely; content, destinations, and navigation state belong to the caller.
 * Requires the shared UI token stylesheet. No hydration or provider is needed.
 */
export function Navbar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={cn(cx('navbar'), className)} {...props} />
}

/** Renders the primary brand link, optionally containing a NavbarBrandDetail. */
export function NavbarBrand({ className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cn(cx('brand'), className)} {...props} />
}

/** Renders muted secondary text alongside the brand without introducing a heading. */
export function NavbarBrandDetail({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(cx('brandDetail'), className)} {...props} />
}

/** Renders supporting text, wrapping onto another row when space is limited. */
export function NavbarDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn(cx('description'), className)} {...props} />
}
