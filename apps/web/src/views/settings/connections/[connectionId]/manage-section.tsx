import type { Command, Connection, SafeError } from '@roadmap/contracts'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { useState } from 'react'
import { useRoadmap } from '@/store/roadmap-provider'
import { ErrorText } from '@/views/shared/settings-shared'
import { AuthorizationGroup, RemoveConnectionGroup } from './management-sections'

type ManageSectionProps = { connection: Connection }

export function ManageSection({ connection }: ManageSectionProps) {
  const {
    projects,
    authorizationOperations,
    configuration,
    configurationVersion,
    command,
    execute,
  } = useRoadmap()
  const [error, setError] = useState<SafeError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const dependents = projects.filter((project) => project.connectionId === connection.id)
  const related = authorizationOperations.filter(
    (operation) => operation.connectionId === connection.id,
  )
  const authorization =
    related.findLast((operation) => operation.status === 'waiting') ?? related.at(-1)
  const blocked = busy || command.inFlight || !configuration.valid

  const run = async (next: Command): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await execute(next)
      if (!outcome.ok) {
        setError(outcome.error)
        return false
      }
      return true
    } catch {
      setError('The server did not confirm the change. Wait for live state before retrying.')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (connection.builtIn) return null

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Manage connection</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <ErrorText error={error} />
        {connection.integration === 'github' && (
          <AuthorizationGroup
            connection={connection}
            authorization={authorization}
            configurationVersion={configurationVersion}
            blocked={blocked}
            run={run}
          />
        )}
        <RemoveConnectionGroup
          connectionId={connection.id}
          dependents={dependents}
          configurationVersion={configurationVersion}
          blocked={blocked}
          run={run}
        />
      </SectionBody>
    </Section>
  )
}
