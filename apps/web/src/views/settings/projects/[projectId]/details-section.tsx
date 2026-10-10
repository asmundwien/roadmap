import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import { TextInput } from '@roadmap/ui/text-input'
import { type FormEvent, useState } from 'react'
import { Link } from '@/navigation'
import type { KnownProjectResult } from '@/resources/results'
import { connectionPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { SettingsFacts } from '@/views/shared/settings-facts'
import { SettingsForm } from '@/views/shared/settings-form'
import { observedLabel, projectIdentity } from '@/views/shared/settings-shared'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import { workflowFeedback } from '@/workflows/workflows'

type DetailsSectionProps = {
  project: KnownProjectResult
}

export function DetailsSection({ project }: DetailsSectionProps) {
  const { workflows, feedback } = useRoadmap((roadmap) => ({
    workflows: roadmap.workflows,
    feedback: workflowFeedback(roadmap.workflowState, 'rename-project', {
      kind: 'project',
      project: project.ref,
    }),
  }))
  const [name, setName] = useState(project.name)
  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void workflows.renameProject({ project: project.ref, name })
  }

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Details</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <WorkflowFeedback feedback={feedback} workflows={workflows} />
        <SettingsFacts>
          <dt>Integration</dt>
          <dd>
            <IntegrationBadge integration={project.ref.integration} />
          </dd>
          <dt>Connection</dt>
          <dd>
            {project.connection ? (
              <Link href={connectionPath(project.connection.id)}>{project.connection.name}</Link>
            ) : (
              project.connectionId
            )}
          </dd>
          <dt>Locator</dt>
          <dd>{project.locator}</dd>
          <dt>Workspace</dt>
          <dd>{project.workspacePath}</dd>
          <dt>Route identity</dt>
          <dd>{projectIdentity(project)}</dd>
          <dt>Last successful source read</dt>
          <dd>{observedLabel(project.availability.observedAt)}</dd>
          <dt>Last successful source destination</dt>
          <dd>
            {project.observedSource.kind === 'link' ? (
              <a href={project.observedSource.href}>{project.observedSource.href}</a>
            ) : project.observedSource.kind === 'file' ? (
              project.observedSource.path
            ) : (
              'No source destination available.'
            )}
          </dd>
          <dt>Map state</dt>
          <dd>{project.mapState}</dd>
        </SettingsFacts>

        <Surface>
          <SurfaceTitle>
            <label htmlFor="project-name">Display name</label>
          </SurfaceTitle>

          <p>
            Set a display name for the project. This name will be shown in the Roadmap interface.
          </p>

          <SettingsForm onSubmit={rename}>
            <ControlGroup>
              <TextInput
                id="project-name"
                name="name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <Button type="submit" disabled={feedback.blocked || feedback.pending}>
                Save name
              </Button>
            </ControlGroup>
          </SettingsForm>
          {feedback.fields.name && <p role="alert">{feedback.fields.name}</p>}
        </Surface>
      </SectionBody>
    </Section>
  )
}
