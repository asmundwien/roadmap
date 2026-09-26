import { NavBar, NavBarLink } from '@roadmap/ui/navbar'
import { type CatalogTab, componentsHash, domainComponentsHash } from '@/router'

const CATALOG_TABS = [
  ['design-system', 'Design system', componentsHash],
  ['domain', 'Domain components', domainComponentsHash],
] as const satisfies readonly (readonly [CatalogTab, string, string])[]

type CatalogNavProps = { className?: string; tab: CatalogTab }

/** Each catalog tab is its own hash route, so the back button and a pasted URL both land right. */
export function CatalogNav({ className, tab }: CatalogNavProps) {
  return (
    <NavBar className={className} label="Component catalog">
      {CATALOG_TABS.map(([id, label, hash]) => (
        <NavBarLink current={id === tab} href={hash} key={id}>
          {label}
        </NavBarLink>
      ))}
    </NavBar>
  )
}
