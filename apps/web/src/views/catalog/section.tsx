import type { ReactNode } from 'react'
import './section.css'

type CatalogSectionProps = {
  title: string
  description: string
  children?: ReactNode
}

export function CatalogSection({ title, description, children }: CatalogSectionProps) {
  return (
    <section className="catalog-section">
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  )
}
