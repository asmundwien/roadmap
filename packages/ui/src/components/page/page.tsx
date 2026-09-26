import cn from 'classnames'
import classNames from 'classnames/bind'
import type { HTMLAttributes } from 'react'
import styles from './page.module.css'

// Own class names resolve through the module with cx; a caller's className is a foreign name and
// is merged with cn so it is never rewritten by a local name that happens to match.
const cx = classNames.bind(styles)

export type PageProps = HTMLAttributes<HTMLElement>

export function Page({ className, ...props }: PageProps) {
  return <main className={cn(cx('page'), className)} {...props} />
}

export type PageHeaderProps = HTMLAttributes<HTMLElement>

export function PageHeader({ className, ...props }: PageHeaderProps) {
  return <header className={cn(cx('header'), className)} {...props} />
}

export type PageEyebrowProps = HTMLAttributes<HTMLParagraphElement>

export function PageEyebrow({ className, ...props }: PageEyebrowProps) {
  return <p className={cn(cx('eyebrow'), className)} {...props} />
}

export type PageTitleProps = HTMLAttributes<HTMLHeadingElement>

export function PageTitle({ className, ...props }: PageTitleProps) {
  return <h1 className={cn(cx('title'), className)} {...props} />
}

export type PageDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export function PageDescription({ className, ...props }: PageDescriptionProps) {
  return <p className={cn(cx('description'), className)} {...props} />
}
