import cn from 'classnames'
import type { HTMLAttributes } from 'react'
import './page.css'

export type PageProps = HTMLAttributes<HTMLElement>

export function Page({ className, ...props }: PageProps) {
  return <main className={cn('shell page', className)} {...props} />
}

export type PageHeaderProps = HTMLAttributes<HTMLElement>

export function PageHeader({ className, ...props }: PageHeaderProps) {
  return <header className={cn('page-header', className)} {...props} />
}

export type PageEyebrowProps = HTMLAttributes<HTMLParagraphElement>

export function PageEyebrow({ className, ...props }: PageEyebrowProps) {
  return <p className={cn('page-header-eyebrow', className)} {...props} />
}

export type PageTitleProps = HTMLAttributes<HTMLHeadingElement>

export function PageTitle({ className, ...props }: PageTitleProps) {
  return <h1 className={cn('page-header-title', className)} {...props} />
}

export type PageDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export function PageDescription({ className, ...props }: PageDescriptionProps) {
  return <p className={cn('page-header-description', className)} {...props} />
}
