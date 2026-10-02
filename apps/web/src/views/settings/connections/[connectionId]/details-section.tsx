import type { Connection, SafeError } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { TextInput } from '@roadmap/ui/text-input'
import { type FormEvent, useState } from 'react'
import { useRoadmap } from '@/store/roadmap-provider'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import styles from '@/views/shared/settings-flow.module.css'
import { ErrorText, observedLabel } from '@/views/shared/settings-shared'
import pageStyles from './page.module.css'

type DetailsSectionProps = { connection: Connection }

export function DetailsSection({ connection }: DetailsSectionProps) {
  const { projects, configuration, configurationVersion, command, execute } = useRoadmap()
  const [error, setError] = useState<SafeError | string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dependents = projects.filter((project) => project.connectionId === connection.id)
  const blocked = busy || command.inFlight || !configuration.valid

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) {
      setError('Enter a Connection name.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const outcome = await execute({
        type: 'rename-connection',
        expectedConfigurationVersion: configurationVersion,
        connectionId: connection.id,
        name,
      })
      if (!outcome.ok) {
        setError(outcome.error)
      } else {
        setNotice(`${connection.name} renamed.`)
      }
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
        <dl className={`${styles['settings-facts']} ${pageStyles.facts}`}>
          <dt>Integration</dt>
          <dd>
            <IntegrationBadge integration={connection.integration} />
          </dd>
          <dt>GitHub user</dt>
          <dd>
            {connection.githubIdentity ? `@${connection.githubIdentity.login}` : 'Not available'}
          </dd>
          <dt>Observed</dt>
          <dd>{observedLabel(connection.availability.observedAt)}</dd>
          <dt>Dependent Projects</dt>
          <dd>{dependents.length}</dd>
        </dl>
        {!connection.builtIn && (
          <form className={styles['settings-form']} onSubmit={rename} key={connection.name}>
            <label htmlFor="connection-name">Connection name</label>
            <ControlGroup>
              <TextInput id="connection-name" name="name" defaultValue={connection.name} />
              <Button variant="primary" type="submit" disabled={blocked}>
                Save name
              </Button>
            </ControlGroup>
          </form>
        )}
      </SectionBody>
    </Section>
  )
}
