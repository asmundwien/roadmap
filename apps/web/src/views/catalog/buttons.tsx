import { Button, ButtonLink } from '@roadmap/ui/button'
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
          <SurfaceTitle>Variant and appearance</SurfaceTitle>
          <SurfaceDescription>
            Use the neutral outline for routine actions. Hover changes the container. Use a solid
            neutral button for the preferred action in a group. Use danger only for destructive
            actions. Keep the initial action outlined. A confirmed destructive action can use the
            solid appearance.
          </SurfaceDescription>
          <div className="catalog-button-matrix-scroll">
            <div className="catalog-button-matrix">
              <span />
              <strong className="catalog-button-column-label">Secondary</strong>
              <strong className="catalog-button-column-label">Primary</strong>
              <strong className="catalog-button-column-label">Danger</strong>
              <strong className="catalog-button-row-label">Outline</strong>
              <div className="catalog-button-matrix-example">
                <Button variant="secondary" appearance="outline" type="button">
                  Routine action
                </Button>
              </div>
              <div className="catalog-button-matrix-example">
                <Button variant="primary" appearance="outline" type="button">
                  Continue
                </Button>
              </div>
              <div className="catalog-button-matrix-example">
                <Button variant="danger" appearance="outline" type="button">
                  Remove
                </Button>
              </div>
              <strong className="catalog-button-row-label">Solid</strong>
              <div className="catalog-button-matrix-example">
                <Button variant="secondary" appearance="solid" type="button">
                  Routine action
                </Button>
              </div>
              <div className="catalog-button-matrix-example">
                <Button variant="primary" appearance="solid" type="button">
                  Continue
                </Button>
              </div>
              <div className="catalog-button-matrix-example">
                <Button variant="danger" appearance="solid" type="button">
                  Confirm removal
                </Button>
              </div>
            </div>
          </div>
        </Surface>

        <Surface className="catalog-button-example">
          <SurfaceTitle>Disabled</SurfaceTitle>
          <SurfaceDescription>
            The native disabled attribute blocks activation. The outline and label use the muted
            pair so the label keeps its contrast.
          </SurfaceDescription>
          <Button type="button" disabled>
            Unavailable
          </Button>
        </Surface>

        <Surface className="catalog-button-example">
          <SurfaceTitle>Navigation</SurfaceTitle>
          <SurfaceDescription>
            Use a button-shaped link for navigation presented as an action. It remains a native
            link.
          </SurfaceDescription>
          <ButtonLink href="#/settings/connections">Connections</ButtonLink>
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
