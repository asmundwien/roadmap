import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
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
import { TextInput } from '@roadmap/ui/text-input'

export function ControlGroupCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Control group</SectionTitle>
        <SectionDescription>
          Group buttons or combine a text input with a button. The group size applies to every
          control, overriding child sizes.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <SectionGroup>
          <SectionGroupTitle>Related actions</SectionGroupTitle>
          <SectionGroupDescription>Adjacent buttons share a border.</SectionGroupDescription>
          <ControlGroup>
            <Button type="button">Cancel</Button>
            <Button variant="primary" type="button">
              Apply
            </Button>
          </ControlGroup>
        </SectionGroup>
        <SectionGroup>
          <SectionGroupTitle>Input and save button</SectionGroupTitle>
          <SectionGroupDescription>
            The large group gives the input and save button the same height.
          </SectionGroupDescription>
          <label htmlFor="catalog-control-name">Name</label>
          <ControlGroup size="large">
            <TextInput id="catalog-control-name" name="name" placeholder="Name" />
            <Button variant="primary" type="button">
              Save
            </Button>
          </ControlGroup>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
