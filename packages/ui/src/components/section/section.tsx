import cn from 'classnames'
import type { HTMLAttributes } from 'react'
import './section.css'

export type SectionProps = HTMLAttributes<HTMLElement>

export function Section({ className, ...props }: SectionProps) {
  return <section className={cn('section', className)} {...props} />
}

export type SectionHeaderProps = HTMLAttributes<HTMLElement>

export function SectionHeader({ className, ...props }: SectionHeaderProps) {
  return <header className={cn('section-header', className)} {...props} />
}

export type SectionTitleProps = HTMLAttributes<HTMLHeadingElement>

export function SectionTitle({ className, ...props }: SectionTitleProps) {
  return <h2 className={cn('section-header-title', className)} {...props} />
}

export type SectionDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export function SectionDescription({ className, ...props }: SectionDescriptionProps) {
  return <p className={cn('section-header-description', className)} {...props} />
}
