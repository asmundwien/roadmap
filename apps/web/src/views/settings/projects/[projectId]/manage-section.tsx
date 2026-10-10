import type { Command, SafeError } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Modal } from '@roadmap/ui/modal'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import { type FormEvent, useState } from 'react'
import type { KnownProjectResult } from '@/resources/results'
import { useRoadmap } from '@/store/roadmap-provider'
import { SettingsForm } from '@/views/shared/settings-form'
import { ErrorText, observedLabel, projectIdentity } from '@/views/shared/settings-shared'
import { WorkspaceFolderSelector } from '@/views/shared/workspace-folder-selector'

type ManageSectionProps = {
  project: KnownProjectResult
  removing: boolean
  onRemove: () => Promise<void>
}

export function ManageSection({ project, removing, onRemove }: ManageSectionProps) {
  const { configuration, configurationVersion, command, execute, query } = useRoadmap(
    (roadmap) => ({
      configuration: roadmap.configuration,
      configurationVersion: roadmap.configurationVersion,
      command: roadmap.command,
      execute: roadmap.execute,
      query: roadmap.query,
    }),
  )
  const [error, setError] = useState<SafeError | string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const blocked = removing || busy || command.inFlight || !configuration.valid

  const run = async (
    next: Extract<Command, { type: 'refresh-project' | 'repair-project-workspace' }>,
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    setWorkspaceError(null)
    try {
      const outcome = await execute(next)
      if (!outcome.ok) {
        if (next.type === 'repair-project-workspace' && outcome.error.field?.includes('workspace'))
          setWorkspaceError(outcome.error.message)
        else setError(outcome.error)
        return
      }
      const result = outcome.result
      const identity = projectIdentity({ ref: result.project })
      switch (result.type) {
        case 'refresh-project': {
          const attempt = result.attempt
          const source =
            attempt.provenance.integration === 'local'
              ? attempt.provenance.path
              : `GitHub repository ${attempt.provenance.repositoryId}, ${attempt.provenance.stage}`
          switch (attempt.kind) {
            case 'observed':
              setNotice(
                `Source read completed for ${identity} at ${observedLabel(attempt.observedAt)}. Attempted at ${observedLabel(attempt.attemptedAt)} from ${source}. A completed read does not imply that source content changed.`,
              )
              break
            case 'degraded':
              setNotice(
                `Refresh for ${identity} was incomplete at ${observedLabel(attempt.attemptedAt)} from ${source}. ${attempt.cause} Last successful source read: ${observedLabel(attempt.observedAt)}. Retained facts are not a new complete source read.`,
              )
              break
            case 'failed':
              setNotice(
                `Source read failed for ${identity} at ${observedLabel(attempt.attemptedAt)} from ${source}. ${attempt.cause} No successful source read was established by this attempt.`,
              )
              break
            case 'proven-absent':
              setNotice(
                `Source absence established for ${identity} at ${observedLabel(attempt.observedAt)}. Attempted at ${observedLabel(attempt.attemptedAt)} from ${source}. This is not a successful read of source content.`,
              )
              break
            default: {
              const exhaustive: never = attempt
              return exhaustive
            }
          }
          return
        }
        case 'repair-project-workspace':
          setNotice(
            result.commit === 'committed'
              ? `Workspace repair committed for ${identity} at configuration version ${result.configurationVersion}. Canonical Workspace: ${result.workspacePath}.`
              : `Workspace repair committed for ${identity} at configuration version ${result.configurationVersion}, but durability is unconfirmed. Canonical Workspace: ${result.workspacePath}. Check configuration before another change.`,
          )
          return
        default: {
          const exhaustive: never = result
          return exhaustive
        }
      }
    } catch {
      setError(
        next.type === 'refresh-project'
          ? 'The refresh may have completed, but its result is unknown. Displayed source facts do not confirm this attempt.'
          : 'The change may have completed. Check the relevant configuration before retrying.',
      )
    } finally {
      setBusy(false)
    }
  }

  const repair = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const path = workspacePath
    if (!path) {
      setWorkspaceError('Choose the moved Workspace.')
      return
    }
    void run({
      type: 'repair-project-workspace',
      expectedConfigurationVersion: configurationVersion,
      project: project.ref,
      workspace: { path },
    })
  }

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Manage project registration</SectionTitle>
      </SectionHeader>
      <SectionBody>
        {notice && <Alert variant="info">{notice}</Alert>}
        <ErrorText error={error} />
        <Surface>
          <SurfaceTitle>Refresh project</SurfaceTitle>
          <p>Check the Project source for current maps and availability.</p>
          <ControlGroup>
            <Button
              type="button"
              disabled={blocked}
              onClick={() =>
                void run({
                  type: 'refresh-project',
                  expectedConfigurationVersion: configurationVersion,
                  project: project.ref,
                })
              }
            >
              Refresh now
            </Button>
          </ControlGroup>
        </Surface>
        {project.capabilities.repairOffered && (
          <Surface>
            <SurfaceTitle>Moved Workspace</SurfaceTitle>
            <p>
              Repair requires proof of the same Project identity. Connection and locator stay
              unchanged.
            </p>
            <SettingsForm onSubmit={repair}>
              <WorkspaceFolderSelector
                label="New Workspace"
                description="Choose the moved folder that contains the same Project."
                path={workspacePath}
                error={workspaceError ?? undefined}
                disabled={blocked}
                query={query}
                onChange={(path) => {
                  setWorkspacePath(path)
                  setWorkspaceError(null)
                }}
              />
              <ControlGroup>
                <Button variant="primary" type="submit" disabled={blocked}>
                  Validate and repair
                </Button>
              </ControlGroup>
            </SettingsForm>
          </Surface>
        )}
        <Surface>
          <SurfaceTitle>Remove project registration</SurfaceTitle>
          <p>The source repository, Wayfinder state, and Workspace remain unchanged.</p>
          <ControlGroup>
            <Button
              variant="danger"
              type="button"
              disabled={blocked}
              onClick={() => setConfirming(true)}
            >
              Remove project registration
            </Button>
          </ControlGroup>
        </Surface>
        <Modal open={confirming} onClose={() => setConfirming(false)} title="Remove project">
          <p>Remove "{project.name}" from Roadmap?</p>
          <ControlGroup>
            <Button
              variant="danger"
              appearance="solid"
              type="button"
              disabled={blocked}
              onClick={() => void onRemove()}
            >
              Remove project
            </Button>
          </ControlGroup>
        </Modal>
      </SectionBody>
    </Section>
  )
}
