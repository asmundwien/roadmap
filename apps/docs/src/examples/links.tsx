import { Link } from '@roadmap/ui/link'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'

export function LinksPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Links</PageTitle>
        <PageDescription>
          Links navigate to a destination. Button-shaped links remain links, not buttons.
        </PageDescription>
      </PageHeader>
      <Surface>
        <SurfaceTitle>Internal</SurfaceTitle>
        <SurfaceDescription>
          Underlined text with a right arrow identifies navigation within the application.
        </SurfaceDescription>
        <Link href="/components/buttons">Buttons</Link>
      </Surface>
      <Surface>
        <SurfaceTitle>External</SurfaceTitle>
        <SurfaceDescription>
          An up-right arrow marks a destination that opens in a new tab.
        </SurfaceDescription>
        <Link href="https://github.com" external>
          GitHub
        </Link>
      </Surface>
    </>
  )
}
