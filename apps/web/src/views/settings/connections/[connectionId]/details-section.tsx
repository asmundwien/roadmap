import type { SafeError } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
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
import { ErrorText, observedLabel } from '@/views/shared/settings-shared'
import styles from './details-section.module.css'

const cx = classNames.bind(styles)

type DetailsSectionProps = { connection: Extract<ConnectionResult, { kind: 'known' }> }

export function DetailsSection({ connection }: DetailsSectionProps) {
  const { configuration, configurationVersion, command, execute } = useRoadmap((roadmap) => ({
    configuration: { valid: roadmap.configuration.valid },
    configurationVersion: roadmap.configurationVersion,
    command: { inFlight: roadmap.command.inFlight },
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
        const result = outcome.result
        setNotice(
          result.commit === 'committed'
            ? `Connection ${result.connectionId} renamed at configuration version ${result.configurationVersion}.`
            : `Connection ${result.connectionId} rename committed at configuration version ${result.configurationVersion}, but durability is unconfirmed.`,
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
          <SettingsForm onSubmit={rename} key={connection.name}>
            <label htmlFor="connection-name">Connection name</label>
            <ControlGroup>
              <TextInput id="connection-name" name="name" defaultValue={connection.name} />
              <Button variant="primary" type="submit" disabled={blocked}>
                Save name
              </Button>
            </ControlGroup>
          </SettingsForm>
        )}
      </SectionBody>
    </Section>
  )
}
