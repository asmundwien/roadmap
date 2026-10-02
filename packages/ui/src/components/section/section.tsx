import cn from 'classnames'
import classNames from 'classnames/bind'
import type { HTMLAttributes } from 'react'
import styles from './section.module.css'

// Own class names resolve through the module with cx; a caller's className is a foreign name and
// is merged with cn so it is never rewritten by a local name that happens to match.
const cx = classNames.bind(styles)

/** Lays out a header beside its content, stacking them at narrower viewport widths. */
export function Section({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn(cx('section'), className)} {...props} />
}

/** Renders the unstyled header in the section's first grid column. */
export function SectionHeader(props: HTMLAttributes<HTMLElement>) {
  return <header {...props} />
}

/** Renders the section title as an `h2`. */
export function SectionTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn(cx('title'), className)} {...props} />
}

/** Renders supporting text beneath the section title. */
export function SectionDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn(cx('description'), className)} {...props} />
}

/** Arranges section content in a vertical grid with spacing between children. */
export function SectionBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(className)} {...props} />
}
