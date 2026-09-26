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
import { ComponentTokenList } from './token-list'
import './actions.css'

const ACTION_DEFAULT_COLOR_TOKENS = [
  '--comp-action-outline-color',
  '--comp-action-label-color',
  '--comp-action-hover-container-color',
  '--comp-action-hover-label-color',
] as const
const ACTION_STRONG_COLOR_TOKENS = [
  '--comp-action-outline-color',
  '--comp-action-strong-container-color',
  '--comp-action-strong-label-color',
  '--comp-action-hover-container-color',
  '--comp-action-hover-label-color',
] as const
const ACTION_DANGER_COLOR_TOKENS = [
  '--comp-action-outline-color',
  '--comp-action-danger-label-color',
  '--comp-action-danger-hover-container-color',
  '--comp-action-danger-hover-label-color',
] as const
const ACTION_DISABLED_COLOR_TOKENS = [
  '--comp-action-disabled-outline-color',
  '--comp-action-disabled-label-color',
] as const

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
          <ComponentTokenList tokens={ACTION_DEFAULT_COLOR_TOKENS} />
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
          <ComponentTokenList tokens={ACTION_STRONG_COLOR_TOKENS} />
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
          <ComponentTokenList tokens={ACTION_DANGER_COLOR_TOKENS} />
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
          <ComponentTokenList tokens={ACTION_DISABLED_COLOR_TOKENS} />
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
