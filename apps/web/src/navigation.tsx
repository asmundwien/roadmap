import { ButtonLink as NativeButtonLink } from '@roadmap/ui/button'
import { Link as NativeLink } from '@roadmap/ui/link'
import { NavbarBrand as NativeNavbarBrand } from '@roadmap/ui/navbar'
import type { AnchorHTMLAttributes, ComponentProps, MouseEvent } from 'react'
import { useHref, useLinkClickHandler } from 'react-router'

function useAnchorNavigation({
  href,
  onClick,
  target,
  download,
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const routerHref = useHref(href)
  const navigate = useLinkClickHandler<HTMLAnchorElement>(href, { target })
  const internal = href.startsWith('/') && !href.startsWith('//')
  return {
    href: internal ? routerHref : href,
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      onClick?.(event)
      if (internal && !event.defaultPrevented && (download == null || download === false)) {
        navigate(event)
      }
    },
  }
}

export function Link(props: ComponentProps<typeof NativeLink>) {
  const navigation = useAnchorNavigation({
    ...props,
    target: props.external ? '_blank' : undefined,
  })
  return <NativeLink {...props} {...navigation} />
}

export function ButtonLink(props: ComponentProps<typeof NativeButtonLink>) {
  const navigation = useAnchorNavigation(props)
  return <NativeButtonLink {...props} {...navigation} />
}

export function NavbarBrand(props: ComponentProps<typeof NativeNavbarBrand> & { href: string }) {
  const navigation = useAnchorNavigation(props)
  return <NativeNavbarBrand {...props} {...navigation} />
}
