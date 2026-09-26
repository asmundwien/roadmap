import { Action, ActionGroup } from '@roadmap/ui'
import { CatalogSection, ComponentTokenList } from './section'
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
    <CatalogSection
      title="Actions"
      description="Native buttons trigger commands; links navigate. Variants set emphasis and intent."
    >
      <div className="catalog-action-examples">
        <section className="catalog-action-example">
          <header>
            <h3>Default</h3>
            <p>
              Use for routine commands and navigation. Hover and keyboard focus change both the
              container and label roles.
            </p>
          </header>
          <ActionGroup>
            <Action type="button">Button</Action>
            <Action element="link" href="#/components">
              Link
            </Action>
          </ActionGroup>
          <ComponentTokenList tokens={ACTION_DEFAULT_COLOR_TOKENS} />
        </section>

        <section className="catalog-action-example">
          <header>
            <h3>Strong</h3>
            <p>
              Use for the preferred action in a group. The resting container has higher emphasis;
              hover and keyboard focus use the shared interaction roles.
            </p>
          </header>
          <Action variant="strong" type="button">
            Continue
          </Action>
          <ComponentTokenList tokens={ACTION_STRONG_COLOR_TOKENS} />
        </section>

        <section className="catalog-action-example">
          <header>
            <h3>Danger</h3>
            <p>
              Use only for destructive commands. Resting and hover colors use the error role and its
              paired container content role.
            </p>
          </header>
          <Action variant="danger" type="button">
            Remove
          </Action>
          <ComponentTokenList tokens={ACTION_DANGER_COLOR_TOKENS} />
        </section>

        <section className="catalog-action-example">
          <header>
            <h3>Unavailable</h3>
            <p>
              Only buttons support this state. The native disabled attribute blocks activation, and
              the outline and label drop to the muted pair so the label keeps its contrast.
            </p>
          </header>
          <Action type="button" disabled>
            Unavailable
          </Action>
          <ComponentTokenList tokens={ACTION_DISABLED_COLOR_TOKENS} />
        </section>

        <section className="catalog-action-example">
          <header>
            <h3>Field size</h3>
            <p>Use the taller size when an action sits beside a form field.</p>
          </header>
          <Action size="field" type="button">
            Choose directory
          </Action>
        </section>
      </div>
    </CatalogSection>
  )
}
