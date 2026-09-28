import type { Connection, RegisteredProject, SafeError } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { TextInput } from '@roadmap/ui/text-input'
import { type FormEvent, useState } from 'react'
import { connectionHash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import {
  ErrorText,
  locatorLabel,
  mapState,
  observedLabel,
  projectIdentity,
} from '@/views/shared/settings-shared'

type DetailsSectionProps = { project: RegisteredProject; connection: Connection | undefined }

export function DetailsSection({ project, connection }: DetailsSectionProps) {
  const { configuration, configurationVersion, command, execute } = useRoadmap()
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
        project: project.key,
        name,
      })
      if (!outcome.ok) setError(outcome.error)
      else setNotice(`${project.name} renamed.`)
    } catch {
      setError('The server did not confirm the change. Wait for live state before retrying.')
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
        <dl className="settings-facts">
          <dt>Integration</dt>
          <dd>
            <IntegrationBadge integration={project.key.integration} />
          </dd>
          <dt>Connection</dt>
          <dd>
            {connection ? (
              <Link href={connectionHash(connection.id)}>{connection.name}</Link>
            ) : (
              project.connectionId
            )}
          </dd>
          <dt>Locator</dt>
          <dd>{locatorLabel(project)}</dd>
          <dt>Workspace</dt>
          <dd>{project.workspace.path}</dd>
          <dt>Route identity</dt>
          <dd>{projectIdentity(project)}</dd>
          <dt>Observed</dt>
          <dd>{observedLabel(project.availability.observedAt)}</dd>
          <dt>Map state</dt>
          <dd>{mapState(project)}</dd>
        </dl>
        <form className="settings-form" onSubmit={(event) => void rename(event)} key={project.name}>
          <label htmlFor="project-name">Display name</label>
          <ControlGroup>
            <TextInput id="project-name" name="name" defaultValue={project.name} />
            <Button variant="primary" type="submit" disabled={blocked}>
              Save name
            </Button>
          </ControlGroup>
        </form>
      </SectionBody>
    </Section>
  )
}
