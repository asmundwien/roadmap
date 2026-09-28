import cn from 'classnames'
import classNames from 'classnames/bind'
import type { HTMLAttributes } from 'react'
import styles from './page.module.css'

// Own class names resolve through the module with cx; a caller's className is a foreign name and
// is merged with cn so it is never rewritten by a local name that happens to match.
const cx = classNames.bind(styles)

/** Sets a centered page width and gutters on the main content landmark. */
export function Page({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <main className={cn(cx('page'), className)} {...props} />
}

/** Constrains the page heading group to the reading width. */
export function PageHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={cn(cx('header'), className)} {...props} />
}

/** Renders a lead-in above the page title. */
export function PageEyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn(cx('eyebrow'), className)} {...props} />
}

/** Renders the page's primary heading as an `h1`. */
export function PageTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 className={cn(cx('title'), className)} {...props} />
}

/** Renders introductory text below the page title. */
export function PageDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn(cx('description'), className)} {...props} />
}
