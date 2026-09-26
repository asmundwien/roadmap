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

export type SectionBodyProps = HTMLAttributes<HTMLDivElement>

export function SectionBody({ className, ...props }: SectionBodyProps) {
  return <div className={cn('section-body', className)} {...props} />
}

export type SectionGroupProps = HTMLAttributes<HTMLElement>

export function SectionGroup({ className, ...props }: SectionGroupProps) {
  return <section className={cn('section-group', className)} {...props} />
}

export type SectionGroupTitleProps = HTMLAttributes<HTMLHeadingElement>

export function SectionGroupTitle({ className, ...props }: SectionGroupTitleProps) {
  return <h3 className={cn('section-group-title', className)} {...props} />
}

export type SectionGroupDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export function SectionGroupDescription({ className, ...props }: SectionGroupDescriptionProps) {
  return <p className={cn('section-group-description', className)} {...props} />
}
