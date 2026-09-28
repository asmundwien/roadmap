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
