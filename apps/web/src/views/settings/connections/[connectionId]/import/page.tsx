import type { ConnectionId } from '@roadmap/contracts/identity'
import type { CommandResult } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { Link as ExternalLink } from '@roadmap/ui/link'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { TextInput } from '@roadmap/ui/text-input'
import { type FormEvent, useState } from 'react'
import { Link } from '@/navigation'
import { type ConnectionResult, resolveConnection } from '@/resources/results'
import { projectSettingsPath, routePaths } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import {
  projectRegistrationDraft,
  projectRegistrationError,
} from '@/views/shared/project-registration'
import { SettingsForm } from '@/views/shared/settings-form'
import { SettingsFormActions } from '@/views/shared/settings-form-actions'
import { ErrorText } from '@/views/shared/settings-shared'
import { WorkspaceFolderSelector } from '@/views/shared/workspace-folder-selector'

type ProjectImportPageProps = { connectionId: ConnectionId }

export function ProjectImportPage({ connectionId }: ProjectImportPageProps) {
  const { connection, configurationValid } = useRoadmap((roadmap) => ({
    connection: resolveConnection(roadmap, connectionId),
    configurationValid: roadmap.configuration.valid,
  }))

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

  return (
    <ProjectImportForm
      key={connection.id}
      connection={connection}
      configurationValid={configurationValid}
    />
  )
}

type ProjectImportFormProps = {
  connection: Extract<ConnectionResult, { kind: 'known' }>
  configurationValid: boolean
}

function ProjectImportForm({ connection, configurationValid }: ProjectImportFormProps) {
  const { configurationVersion, command, query, execute } = useRoadmap((roadmap) => ({
    configurationVersion: roadmap.configurationVersion,
    command: { inFlight: roadmap.command.inFlight },
    query: roadmap.query,
    execute: roadmap.execute,
  }))
  const [workspacePath, setWorkspacePath] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Extract<CommandResult, { type: 'register-project' }> | null>(
    null,
  )
  const blocked = saving || command.inFlight || !configurationValid

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const draft = projectRegistrationDraft(
      new FormData(event.currentTarget),
      connection.registration.identity,
      workspacePath,
    )
    setErrors(draft.errors)
    setGeneralError(null)
    if (!draft.candidate) return

    setSaving(true)
    try {
      const outcome = await execute({
        type: 'register-project',
        expectedConfigurationVersion: configurationVersion,
        candidate: draft.candidate,
      })
      if (outcome.ok) {
        setSaved(outcome.result)
        return
      }
      const { fields, general } = projectRegistrationError(outcome.error)
      setErrors(fields)
      setGeneralError(general)
    } catch {
      setGeneralError(
        'Registration completion is unknown. No Project identity or saved version was confirmed. Check the configuration before submitting another registration.',
      )
    } finally {
      setSaving(false)
    }
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
          {saved ? (
            <Alert variant={saved.commit === 'committed' ? 'info' : 'error'}>
              <strong>
                {saved.commit === 'committed'
                  ? 'Project registered.'
                  : 'Project registration committed, but durability is unconfirmed.'}
              </strong>
              <span>
                {saved.project.integration}/{saved.project.projectId} through Connection{' '}
                {saved.connectionId}, configuration version {saved.configurationVersion}.
              </span>
              <span>Workspace: {saved.workspacePath}</span>
              {saved.commit === 'committed' && (
                <Link href={projectSettingsPath(saved.project)}>View project registration</Link>
              )}
            </Alert>
          ) : (
            <SettingsForm onSubmit={(event) => void submit(event)}>
              {connection.integration === 'github' ? (
                <>
                  <WorkspaceFolderSelector
                    label={connection.registration.folderLabel}
                    description={connection.registration.description}
                    path={workspacePath}
                    error={errors.workspace}
                    disabled={blocked}
                    query={query}
                    onChange={(path) => {
                      setWorkspacePath(path)
                      setErrors({})
                    }}
                  />
                  <Alert variant="info">
                    <span>
                      GitHub authorization and repository installation are separate grants.
                    </span>
                    {connection.registration.newInstallation.kind === 'link' && (
                      <ExternalLink href={connection.registration.newInstallation.href} external>
                        Configure repository access
                      </ExternalLink>
                    )}
                  </Alert>
                </>
              ) : (
                <WorkspaceFolderSelector
                  label={connection.registration.folderLabel}
                  description={connection.registration.description}
                  path={workspacePath}
                  error={errors.folder}
                  disabled={blocked}
                  query={query}
                  onChange={(path) => {
                    setWorkspacePath(path)
                    setErrors({})
                  }}
                />
              )}
              <label htmlFor="project-import-display-name">
                Display name
                <TextInput
                  id="project-import-display-name"
                  name="displayName"
                  placeholder="Optional"
                />
              </label>
              <ErrorText error={generalError ?? errors.connection ?? null} />
              <SettingsFormActions>
                <Button variant="primary" type="submit" disabled={blocked}>
                  {saving ? 'Validating…' : 'Validate and save'}
                </Button>
              </SettingsFormActions>
            </SettingsForm>
          )}
        </SectionBody>
      </Section>
    </Page>
  )
}
