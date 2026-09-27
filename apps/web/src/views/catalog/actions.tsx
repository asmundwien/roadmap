import { Action, ActionGroup } from '@roadmap/ui/action'
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
import './actions.css'

export function ActionsCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Actions</SectionTitle>
        <SectionDescription>
          Native buttons trigger commands; links navigate. Variants set emphasis and intent.
        </SectionDescription>
      </SectionHeader>

      <SectionBody>
        <SectionGroup className="catalog-action-example">
          <SectionGroupTitle>Default</SectionGroupTitle>
          <SectionGroupDescription>
            Use for routine commands and navigation. Hover and keyboard focus change both the
            container and label roles.
          </SectionGroupDescription>
          <ActionGroup>
            <Action type="button">Button</Action>
            <Action element="link" href="#/components">
              Link
            </Action>
          </ActionGroup>
        </SectionGroup>

        <SectionGroup className="catalog-action-example">
          <SectionGroupTitle>Strong</SectionGroupTitle>
          <SectionGroupDescription>
            Use for the preferred action in a group. The resting container has higher emphasis;
            hover and keyboard focus use the shared interaction roles.
          </SectionGroupDescription>
          <Action variant="strong" type="button">
            Continue
          </Action>
        </SectionGroup>

        <SectionGroup className="catalog-action-example">
          <SectionGroupTitle>Danger</SectionGroupTitle>
          <SectionGroupDescription>
            Use only for destructive commands. Resting and hover colors use the error role and its
            paired container content role.
          </SectionGroupDescription>
          <Action variant="danger" type="button">
            Remove
          </Action>
        </SectionGroup>

        <SectionGroup className="catalog-action-example">
          <SectionGroupTitle>Unavailable</SectionGroupTitle>
          <SectionGroupDescription>
            Only buttons support this state. The native disabled attribute blocks activation, and
            the outline and label drop to the muted pair so the label keeps its contrast.
          </SectionGroupDescription>
          <Action type="button" disabled>
            Unavailable
          </Action>
        </SectionGroup>

        <SectionGroup className="catalog-action-example">
          <SectionGroupTitle>Field size</SectionGroupTitle>
          <SectionGroupDescription>
            Use the taller size when an action sits beside a form field.
          </SectionGroupDescription>
          <Action size="field" type="button">
            Choose directory
          </Action>
        </SectionGroup>
      </SectionBody>
    </Section>
  )
}
