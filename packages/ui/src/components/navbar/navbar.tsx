import cn from 'classnames'
import classNames from 'classnames/bind'
import type { AnchorHTMLAttributes, HTMLAttributes } from 'react'
import styles from './navbar.module.css'

// Own class names resolve through the module with cx; a caller's className is a foreign name and
// is merged with cn so it is never rewritten by a local name that happens to match.
const cx = classNames.bind(styles)

export type NavBarProps = HTMLAttributes<HTMLElement> & { label: string }

/**
 * A bar of navigation links. Every destination is a real link, so the browser's history, back
 * button, and middle click keep working; the caller decides what "current" means.
 */
export function NavBar({ className, label, ...props }: NavBarProps) {
  return <nav aria-label={label} className={cn(cx('navbar'), className)} {...props} />
}

export type NavBarLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { current?: boolean }

export function NavBarLink({ className, current = false, ...props }: NavBarLinkProps) {
  return (
    <a
      aria-current={current ? 'page' : undefined}
      className={cn(cx('link', current && 'current'), className)}
      {...props}
    />
  )
}
