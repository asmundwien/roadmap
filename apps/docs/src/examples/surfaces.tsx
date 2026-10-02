import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'

export function SurfacesPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Surfaces</PageTitle>
        <PageDescription>
          Subtle, default, and emphasized set visual priority. Danger marks destructive content.
          None announces an error; use Alert for errors or notices. Each Surface pads its contents
          and adds bottom margin to separate it from the next example.
        </PageDescription>
      </PageHeader>
      <Surface variant="subtle">
        <SurfaceTitle>Subtle</SurfaceTitle>
        <SurfaceDescription>
          Low container color and a thin outline. Use for supporting details that should recede
          beside the main content.
        </SurfaceDescription>
        <span>Related information stays together.</span>
      </Surface>
      <Surface>
        <SurfaceTitle>Default</SurfaceTitle>
        <SurfaceDescription>
          Standard container color and a thin outline. Use for ordinary groups of controls or
          content; omitting variant selects this appearance.
        </SurfaceDescription>
        <span>Surface's bottom margin separates it from its siblings.</span>
      </Surface>
      <Surface variant="emphasized">
        <SurfaceTitle>Emphasized</SurfaceTitle>
        <SurfaceDescription>
          High container color, a stronger outline, and a white leading edge. Use to draw attention
          to an important group, not to signal an error.
        </SurfaceDescription>
        <span>Surface itself owns its padding and spacing between its contents.</span>
      </Surface>
      <Surface variant="danger">
        <SurfaceTitle>Danger</SurfaceTitle>
        <SurfaceDescription>
          Error-container color with an error-colored outline. Reserve for destructive actions such
          as removing a connection, not routine errors or notices.
        </SurfaceDescription>
        <span>Removal requires confirmation.</span>
      </Surface>
    </>
  )
}
