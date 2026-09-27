import { Button, ButtonGroup } from '@roadmap/ui/button'
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
          Buttons trigger commands. Variants set emphasis and intent.
        </SectionDescription>
      </SectionHeader>

      <SectionBody>
        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Default</SectionGroupTitle>
          <SectionGroupDescription>
            Use for routine commands. Hover and keyboard focus change the container and label roles.
          </SectionGroupDescription>
          <Button type="button">Button</Button>
        </SectionGroup>

        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Button group</SectionGroupTitle>
          <SectionGroupDescription>
            Group related buttons without including links.
          </SectionGroupDescription>
          <ButtonGroup>
            <Button type="button">Cancel</Button>
            <Button variant="strong" type="button">
              Apply
            </Button>
          </ButtonGroup>
        </SectionGroup>

        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Strong</SectionGroupTitle>
          <SectionGroupDescription>
            Use for the preferred action in a group. The resting container has higher emphasis;
            hover and keyboard focus use the shared interaction roles.
          </SectionGroupDescription>
          <Button variant="strong" type="button">
            Continue
          </Button>
        </SectionGroup>

        <SectionGroup className="catalog-button-example">
          <SectionGroupTitle>Danger</SectionGroupTitle>
          <SectionGroupDescription>
            Use only for destructive commands. Resting and hover colors use the error role and its
            paired container content role.
          </SectionGroupDescription>
          <Button variant="danger" type="button">
            Remove
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
          <SectionGroupTitle>Field size</SectionGroupTitle>
          <SectionGroupDescription>
            Use the taller size when a button sits beside a form field.
          </SectionGroupDescription>
          <Button size="field" type="button">
            Choose directory
          </Button>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
