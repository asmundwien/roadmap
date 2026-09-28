import { Button } from '@roadmap/ui/button'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import './buttons.css'

export function ButtonsCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Buttons</SectionTitle>
        <SectionDescription>
          Variants express action role. Appearance sets fill; size sets control height.
        </SectionDescription>
      </SectionHeader>

      <SectionBody>
        <Surface className="catalog-button-example">
          <SurfaceTitle>Secondary</SurfaceTitle>
          <SurfaceDescription>
            Use the neutral outline for routine actions. Hover changes the container.
          </SurfaceDescription>
          <Button type="button">Routine action</Button>
        </Surface>

        <Surface className="catalog-button-example">
          <SurfaceTitle>Primary</SurfaceTitle>
          <SurfaceDescription>
            Use a solid neutral button for the preferred action in a group.
          </SurfaceDescription>
          <Button variant="primary" type="button">
            Continue
          </Button>
        </Surface>

        <Surface className="catalog-button-example">
          <SurfaceTitle>Danger</SurfaceTitle>
          <SurfaceDescription>
            Use danger only for destructive actions. Keep the initial action outlined.
          </SurfaceDescription>
          <Button variant="danger" type="button">
            Remove
          </Button>
        </Surface>

        <Surface className="catalog-button-example">
          <SurfaceTitle>Solid danger</SurfaceTitle>
          <SurfaceDescription>
            A confirmed destructive action can use the solid appearance.
          </SurfaceDescription>
          <Button variant="danger" appearance="solid" type="button">
            Confirm removal
          </Button>
        </Surface>

        <Surface className="catalog-button-example">
          <SurfaceTitle>Unavailable</SurfaceTitle>
          <SurfaceDescription>
            The native disabled attribute blocks activation. The outline and label use the muted
            pair so the label keeps its contrast.
          </SurfaceDescription>
          <Button type="button" disabled>
            Unavailable
          </Button>
        </Surface>

        <Surface className="catalog-button-example">
          <SurfaceTitle>Sizes</SurfaceTitle>
          <SurfaceDescription>
            Small, medium, and large have minimum heights of 32, 40, and 48 pixels. Medium is the
            default and aligns with standard form fields.
          </SurfaceDescription>
          <div className="catalog-button-sizes">
            <Button size="small" type="button">
              Small
            </Button>
            <Button type="button">Medium</Button>
            <Button size="large" type="button">
              Large
            </Button>
          </div>
        </Surface>
      </SectionBody>
    </Section>
  )
}
