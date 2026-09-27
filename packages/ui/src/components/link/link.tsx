import type { AnchorHTMLAttributes } from 'react'
import styles from './link.module.css'

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'href'> & {
  href: string
}

export function Link({ href, ...props }: LinkProps) {
  return <a className={styles.link} href={href} {...props} />
}
