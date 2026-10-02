import type { Connection, ProjectKey } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { TextInput } from '@roadmap/ui/text-input'
import { type FormEvent, useState } from 'react'
import { connectionSettingsHash, projectRegistrationHash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import {
  admittedProjectKey,
  projectRegistrationDraft,
  projectRegistrationError,
} from '@/views/shared/project-registration'
import styles from '@/views/shared/settings-flow.module.css'
import { ErrorText } from '@/views/shared/settings-shared'
import { WorkspaceFolderSelector } from '@/views/shared/workspace-folder-selector'

type ProjectImportPageProps = { connectionId: string }

export function ProjectImportPage({ connectionId }: ProjectImportPageProps) {
  const { connections, capturedAt, supportedIntegrations, configuration } = useRoadmap()
  const connection = connections.find((candidate) => candidate.id === connectionId)

  if (!connection) {
    return (
      <Page>
        <PageHeader>
          <div>
            <PageEyebrow>Settings / Connections</PageEyebrow>
            <PageTitle>
              {capturedAt === null ? 'Loading connection' : 'Connection not found'}
            </PageTitle>
          </div>
        </PageHeader>
        <Link href={connectionSettingsHash}>Back to Connections</Link>
      </Page>
    )
  }

  const githubInstallationUrl = supportedIntegrations.find(
    (integration) => integration.integration === 'github',
  )?.newInstallationUrl

  return (
    <ProjectImportForm
      key={connection.id}
      connection={connection}
      githubInstallationUrl={githubInstallationUrl}
      configurationValid={configuration.valid}
    />
  )
}

type ProjectImportFormProps = {
  connection: Connection
  githubInstallationUrl: string | undefined
  configurationValid: boolean
}

function ProjectImportForm({
  connection,
  githubInstallationUrl,
  configurationValid,
}: ProjectImportFormProps) {
  const { configurationVersion, command, query, execute } = useRoadmap()
  const [workspacePath, setWorkspacePath] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ project: ProjectKey | null } | null>(null)
  const blocked = saving || command.inFlight || !configurationValid

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const draft = projectRegistrationDraft(
      new FormData(event.currentTarget),
      connection,
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
        setSaved({
          project: admittedProjectKey(outcome.state.projects, draft.candidate) ?? null,
        })
        return
      }
      const { fields, general } = projectRegistrationError(outcome.error)
      setErrors(fields)
      setGeneralError(general)
    } catch {
      setGeneralError(
        'The server did not confirm registration. Wait for live state before retrying.',
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
      {connection.availability.status !== 'available' && (
        <Alert>
          <strong>{connection.name} is not available.</strong>
          <span>{connection.availability.cause}</span>
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
            <Alert variant="info">
              <strong>Project validated and registered.</strong>
              <span>Roadmap queued it for reconciliation.</span>
              {saved.project && (
                <Link href={projectRegistrationHash(saved.project)}>View project registration</Link>
              )}
            </Alert>
          ) : (
            <form className={styles['settings-form']} onSubmit={(event) => void submit(event)}>
              {connection.integration === 'github' ? (
                <>
                  <WorkspaceFolderSelector
                    label="Workspace"
                    description="Roadmap derives and verifies the repository from this Git worktree's origin remote."
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
                    {githubInstallationUrl && (
                      <Link href={githubInstallationUrl} external>
                        Configure repository access
                      </Link>
                    )}
                  </Alert>
                </>
              ) : (
                <WorkspaceFolderSelector
                  label="Project folder and Workspace"
                  description="Local uses this one readable folder as both locator and Workspace."
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
              <ControlGroup className={styles['settings-form-actions']}>
                <Button variant="primary" type="submit" disabled={blocked}>
                  {saving ? 'Validating…' : 'Validate and save'}
                </Button>
              </ControlGroup>
            </form>
          )}
        </SectionBody>
      </Section>
    </Page>
  )
}
