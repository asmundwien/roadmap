import {
  type Command,
  type CommandResultFor,
  commandResultFor,
  type SafeError,
} from '@roadmap/contracts/operations'
import type { Connection } from '@roadmap/contracts/state'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { useState } from 'react'
import { useRoadmap } from '@/store/roadmap-provider'
import { ErrorText } from '@/views/shared/settings-shared'
import { AuthorizationGroup, RemoveConnectionGroup } from './management-sections'

type ManageSectionProps = {
  connection: Connection
  removing: boolean
  onRemove: () => Promise<void>
}

export function ManageSection({ connection, removing, onRemove }: ManageSectionProps) {
  const {
    projects,
    authorizationOperations,
    configuration,
    configurationVersion,
    command,
    execute,
  } = useRoadmap((roadmap) => ({
    projects: roadmap.projects,
    authorizationOperations: roadmap.authorizationOperations,
    configuration: { valid: roadmap.configuration.valid },
    configurationVersion: roadmap.configurationVersion,
    command: { inFlight: roadmap.command.inFlight },
    execute: roadmap.execute,
  }))
  const [error, setError] = useState<SafeError | string | null>(null)
  const [busy, setBusy] = useState(false)
  const dependents = projects.filter((project) => project.connectionId === connection.id)
  const related = authorizationOperations.filter(
    (operation) =>
      ((operation.status === 'waiting' || operation.status === 'terminal') &&
        operation.connectionId === connection.id) ||
      (operation.status === 'granted' &&
        operation.connection.kind === 'current' &&
        operation.connection.id === connection.id),
  )
  const authorization =
    related.findLast((operation) => operation.status === 'waiting') ?? related.at(-1)
  const blocked = removing || busy || command.inFlight || !configuration.valid

  const run = async <C extends Command>(next: C): Promise<CommandResultFor<C> | null> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await execute(next)
      if (!outcome.ok) {
        setError(outcome.error)
        return null
      }
      if (!commandResultFor(next, outcome.result)) {
        throw new Error('The result does not match the initiating Connection command.')
      }
      return outcome.result
    } catch {
      setError('The change may have completed. Check the relevant configuration before retrying.')
      return null
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
        <RemoveConnectionGroup dependents={dependents} blocked={blocked} onRemove={onRemove} />
      </SectionBody>
    </Section>
  )
}
