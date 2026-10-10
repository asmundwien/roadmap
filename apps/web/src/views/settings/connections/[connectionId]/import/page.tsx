import type { ConnectionId } from '@roadmap/contracts/identity'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { Link as ExternalLink } from '@roadmap/ui/link'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { TextInput } from '@roadmap/ui/text-input'
import { type FormEvent, useState } from 'react'
import { Link } from '@/navigation'
import { type ConnectionResult, resolveConnection } from '@/resources/results'
import { routePaths } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { SettingsForm } from '@/views/shared/settings-form'
import { SettingsFormActions } from '@/views/shared/settings-form-actions'
import { ErrorText } from '@/views/shared/settings-shared'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import { WorkspaceFolderSelector } from '@/views/shared/workspace-folder-selector'
import { type WorkflowScope, workflowFeedback } from '@/workflows/workflows'

type ProjectImportPageProps = { connectionId: ConnectionId }

export function ProjectImportPage({ connectionId }: ProjectImportPageProps) {
  const connection = useRoadmap((roadmap) => resolveConnection(roadmap, connectionId))

  if (connection.kind === 'missing') {
    return (
      <Page>
        <PageHeader>
          <div>
            <PageEyebrow>Settings / Connections</PageEyebrow>
            <PageTitle>Connection not found</PageTitle>
          </div>
        </PageHeader>
        <Link href={routePaths.connections}>Back to Connections</Link>
      </Page>
    )
  }

  return <ProjectImportForm key={connection.id} connection={connection} />
}

type ProjectImportFormProps = {
  connection: Extract<ConnectionResult, { kind: 'known' }>
}

function ProjectImportForm({ connection }: ProjectImportFormProps) {
  const owner: WorkflowScope = {
    kind: 'registration',
    integration: connection.registration.identity.integration,
    connectionId: connection.registration.identity.id,
  }
  const { workflows, feedback, configurationValid } = useRoadmap((roadmap) => ({
    workflows: roadmap.workflows,
    feedback: workflowFeedback(roadmap.workflowState, 'register-project', owner),
    configurationValid: roadmap.configuration.valid,
  }))
  const [workspacePath, setWorkspacePath] = useState('')
  const [displayName, setDisplayName] = useState('')
  const acknowledged =
    feedback.current?.kind === 'acknowledged' && feedback.current.operation === 'register-project'
      ? feedback.current.result
      : null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void workflows.registerProject({
      candidate: {
        integration: connection.registration.identity.integration,
        connectionId: connection.registration.identity.id,
        workspace: { path: workspacePath },
        ...(displayName ? { displayName } : {}),
      },
    })
  }

  return (
    <Page>
      <PageHeader>
        <PageEyebrow>Settings / Connections / {connection.name}</PageEyebrow>
        <PageTitle>Import project</PageTitle>
      </PageHeader>
      {!configurationValid && (
        <Alert>
          <strong>Configuration needs repair.</strong>
          <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
        </Alert>
      )}
      {connection.health.status !== 'available' && (
        <Alert>
          <strong>{connection.health.label}</strong>
          <span>{connection.health.cause}</span>
        </Alert>
      )}
      <Section>
        <SectionHeader>
          <SectionTitle>
            Project registration <IntegrationBadge integration={connection.integration} />
          </SectionTitle>
        </SectionHeader>
        <SectionBody>
          <WorkflowFeedback feedback={feedback} workflows={workflows} />
          {acknowledged ? (
            <Alert variant={acknowledged.commit === 'committed' ? 'info' : 'error'}>
              <span>
                {acknowledged.project.integration}/{acknowledged.project.projectId} through
                Connection {acknowledged.connectionId}, configuration version{' '}
                {acknowledged.configurationVersion}.
              </span>
              <span>Workspace: {acknowledged.workspacePath}</span>
            </Alert>
          ) : null}
          <SettingsForm onSubmit={submit}>
            <WorkspaceFolderSelector
              owner={owner}
              label={connection.registration.folderLabel}
              description={connection.registration.description}
              path={workspacePath}
              error={feedback.fields.workspace ?? feedback.fields.folder}
              onChange={setWorkspacePath}
            />
            {connection.integration === 'github' && (
              <Alert variant="info">
                <span>GitHub authorization and repository installation are separate grants.</span>
                {connection.registration.newInstallation.kind === 'link' && (
                  <ExternalLink href={connection.registration.newInstallation.href} external>
                    Configure repository access
                  </ExternalLink>
                )}
              </Alert>
            )}
            <label htmlFor="project-import-display-name">
              Display name
              <TextInput
                id="project-import-display-name"
                name="displayName"
                placeholder="Optional"
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
              />
            </label>
            <ErrorText error={feedback.fields.displayName ?? feedback.fields.name ?? null} />
            <ErrorText error={feedback.fields.connection ?? null} />
            <SettingsFormActions>
              <Button
                variant="primary"
                type="submit"
                disabled={feedback.blocked || feedback.pending}
              >
                {feedback.pending ? 'Validating…' : 'Validate and save'}
              </Button>
            </SettingsFormActions>
          </SettingsForm>
        </SectionBody>
      </Section>
    </Page>
  )
}
