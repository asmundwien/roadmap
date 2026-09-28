import { Button } from '@roadmap/ui/button'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionGroup,
  SectionGroupDescription,
  SectionGroupTitle,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
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
        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Secondary</SectionGroupTitle>
          <SectionGroupDescription>
            Use the neutral outline for routine actions. Hover changes the container.
          </SectionGroupDescription>
          <Button type="button">Routine action</Button>
        </SectionGroup>

        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Primary</SectionGroupTitle>
          <SectionGroupDescription>
            Use a solid neutral button for the preferred action in a group.
          </SectionGroupDescription>
          <Button variant="primary" type="button">
            Continue
          </Button>
        </SectionGroup>

        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Danger</SectionGroupTitle>
          <SectionGroupDescription>
            Use danger only for destructive actions. Keep the initial action outlined.
          </SectionGroupDescription>
          <Button variant="danger" type="button">
            Remove
          </Button>
        </SectionGroup>

        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Solid danger</SectionGroupTitle>
          <SectionGroupDescription>
            A confirmed destructive action can use the solid appearance.
          </SectionGroupDescription>
          <Button variant="danger" appearance="solid" type="button">
            Confirm removal
          </Button>
        </SectionGroup>

        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Unavailable</SectionGroupTitle>
          <SectionGroupDescription>
            The native disabled attribute blocks activation. The outline and label use the muted
            pair so the label keeps its contrast.
          </SectionGroupDescription>
          <Button type="button" disabled>
            Unavailable
          </Button>
        </SectionGroup>

        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Sizes</SectionGroupTitle>
          <SectionGroupDescription>
            Small, medium, and large have minimum heights of 32, 40, and 48 pixels. Medium is the
            default and aligns with standard form fields.
          </SectionGroupDescription>
          <div className="catalog-button-sizes">
            <Button size="small" type="button">
              Small
            </Button>
            <Button type="button">Medium</Button>
            <Button size="large" type="button">
              Large
            </Button>
          </div>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
