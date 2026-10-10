import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { TextInput } from '@roadmap/ui/text-input'
import classNames from 'classnames/bind'
import { type FormEvent, useState } from 'react'
import type { ConnectionResult } from '@/resources/results'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { SettingsFacts } from '@/views/shared/settings-facts'
import { SettingsForm } from '@/views/shared/settings-form'
import { observedLabel } from '@/views/shared/settings-shared'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import { workflowFeedback } from '@/workflows/workflows'
import styles from './details-section.module.css'

const cx = classNames.bind(styles)

type DetailsSectionProps = { connection: Extract<ConnectionResult, { kind: 'known' }> }

export function DetailsSection({ connection }: DetailsSectionProps) {
  const { workflows, feedback } = useRoadmap((roadmap) => ({
    workflows: roadmap.workflows,
    feedback: workflowFeedback(roadmap.workflowState, 'rename-connection', {
      kind: 'connection',
      connectionId: connection.id,
    }),
  }))
  const [name, setName] = useState(connection.name)
  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void workflows.renameConnection({ connectionId: connection.id, name })
  }

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Details</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <WorkflowFeedback feedback={feedback} workflows={workflows} />
        <SettingsFacts className={cx('facts')}>
          <dt>Integration</dt>
          <dd>
            <IntegrationBadge integration={connection.integration} />
          </dd>
          <dt>GitHub user</dt>
          <dd>{connection.login ? `@${connection.login}` : 'Not available'}</dd>
          <dt>Observed</dt>
          <dd>{observedLabel(connection.health.observedAt)}</dd>
          <dt>Dependent Projects</dt>
          <dd>{connection.projectCount}</dd>
        </SettingsFacts>
        {!connection.builtIn && (
          <SettingsForm onSubmit={rename}>
            <label htmlFor="connection-name">Connection name</label>
            <ControlGroup>
              <TextInput
                id="connection-name"
                name="name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                aria-invalid={Boolean(feedback.fields.name)}
                aria-describedby={feedback.fields.name ? 'connection-name-error' : undefined}
              />
              <Button
                variant="primary"
                type="submit"
                disabled={feedback.blocked || feedback.pending}
              >
                Save name
              </Button>
            </ControlGroup>
            {feedback.fields.name && (
              <p id="connection-name-error" role="alert">
                {feedback.fields.name}
              </p>
            )}
          </SettingsForm>
        )}
      </SectionBody>
    </Section>
  )
}
