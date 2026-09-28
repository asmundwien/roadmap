import type { AnchorHTMLAttributes } from 'react'
import styles from './link.module.css'

/** Native anchor props with a required destination; `target` and `className` are controlled by the component. */
export type LinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'className' | 'href' | 'target'
> & {
  href: string
  /** Opens a new tab and adds `noopener noreferrer` to `rel` when true. Defaults to false. */
  external?: boolean
}

/** Renders a link with a directional icon. Set `external` for an outward arrow and new-tab navigation. */
export function Link({ href, children, external = false, rel, ...props }: LinkProps) {
  return (
    <a
      className={styles.link}
      href={href}
      {...props}
      target={external ? '_blank' : undefined}
      rel={external ? `noopener noreferrer${rel ? ` ${rel}` : ''}` : rel}
    >
      {children}
      <svg className={styles.arrow} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {external ? <path d="M4 12 12 4M5 4h7v7" /> : <path d="M2.5 8h10m-4-4 4 4-4 4" />}
      </svg>
    </a>
  )
}
