import cn from 'classnames'
import classNames from 'classnames/bind'
import type { HTMLAttributes } from 'react'
import styles from './section.module.css'

// Own class names resolve through the module with cx; a caller's className is a foreign name and
// is merged with cn so it is never rewritten by a local name that happens to match.
const cx = classNames.bind(styles)

export type SectionProps = HTMLAttributes<HTMLElement>

export function Section({ className, ...props }: SectionProps) {
  return <section className={cn(cx('section'), className)} {...props} />
}

export type SectionHeaderProps = HTMLAttributes<HTMLElement>

/** The header is the section grid's first column and carries no styling of its own. */
export function SectionHeader(props: SectionHeaderProps) {
  return <header {...props} />
}

export type SectionTitleProps = HTMLAttributes<HTMLHeadingElement>

export function SectionTitle({ className, ...props }: SectionTitleProps) {
  return <h2 className={cn(cx('title'), className)} {...props} />
}

export type SectionDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export function SectionDescription({ className, ...props }: SectionDescriptionProps) {
  return <p className={cn(cx('description'), className)} {...props} />
}

export type SectionBodyProps = HTMLAttributes<HTMLDivElement>

export function SectionBody({ className, ...props }: SectionBodyProps) {
  return <div className={cn(cx('body'), className)} {...props} />
}

export type SectionGroupProps = HTMLAttributes<HTMLElement>

export function SectionGroup({ className, ...props }: SectionGroupProps) {
  return <section className={cn(cx('group'), className)} {...props} />
}

export type SectionGroupTitleProps = HTMLAttributes<HTMLHeadingElement>

export function SectionGroupTitle({ className, ...props }: SectionGroupTitleProps) {
  return <h3 className={cn(cx('group-title'), className)} {...props} />
}

export type SectionGroupDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export function SectionGroupDescription({ className, ...props }: SectionGroupDescriptionProps) {
  return <p className={cn(cx('group-description'), className)} {...props} />
}
