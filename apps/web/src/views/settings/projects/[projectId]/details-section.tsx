import type { SafeError } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
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
import { ErrorText, observedLabel, projectIdentity } from '@/views/shared/settings-shared'

type DetailsSectionProps = {
  project: KnownProjectResult
}

export function DetailsSection({ project }: DetailsSectionProps) {
  const { configuration, configurationVersion, command, execute } = useRoadmap((roadmap) => ({
    configuration: roadmap.configuration,
    configurationVersion: roadmap.configurationVersion,
    command: roadmap.command,
    execute: roadmap.execute,
  }))
  const [error, setError] = useState<SafeError | string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const blocked = busy || command.inFlight || !configuration.valid

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) {
      setError('Enter a display name.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const outcome = await execute({
        type: 'rename-project',
        expectedConfigurationVersion: configurationVersion,
        project: project.ref,
        name,
      })
      if (!outcome.ok) setError(outcome.error)
      else {
        const result = outcome.result
        const identity = projectIdentity({ ref: result.project })
        setNotice(
          result.commit === 'committed'
            ? `Display name change committed for ${identity} at configuration version ${result.configurationVersion}.`
            : `Display name change committed for ${identity} at configuration version ${result.configurationVersion}, but durability is unconfirmed. Check configuration before another change.`,
        )
      }
    } catch {
      setError('The change may have completed. Check the relevant configuration before retrying.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Details</SectionTitle>
      </SectionHeader>
      <SectionBody>
        {notice && <Alert variant="info">{notice}</Alert>}
        <ErrorText error={error} />
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

          <SettingsForm onSubmit={(event) => void rename(event)} key={project.name}>
            <ControlGroup>
              <TextInput id="project-name" name="name" defaultValue={project.name} />
              <Button type="submit" disabled={blocked}>
                Save name
              </Button>
            </ControlGroup>
          </SettingsForm>
        </Surface>
      </SectionBody>
    </Section>
  )
}
