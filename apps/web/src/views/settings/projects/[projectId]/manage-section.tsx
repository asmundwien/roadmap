import type { Command, RegisteredProject, SafeError } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Modal } from '@roadmap/ui/modal'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import { type FormEvent, useState } from 'react'
import { connectionHash, connectionSettingsHash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { SettingsForm } from '@/views/shared/settings-form'
import { ErrorText } from '@/views/shared/settings-shared'
import { WorkspaceFolderSelector } from '@/views/shared/workspace-folder-selector'

type ManageSectionProps = { project: RegisteredProject; connectionExists: boolean }

export function ManageSection({ project, connectionExists }: ManageSectionProps) {
  const { configuration, configurationVersion, command, execute, query } = useRoadmap()
  const [error, setError] = useState<SafeError | string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const blocked = busy || command.inFlight || !configuration.valid

  const run = async (next: Command, success: string): Promise<boolean> => {
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
        return false
      }
      setNotice(success)
      return true
    } catch {
      setError('The server did not confirm the change. Wait for live state before retrying.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const repair = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const path = workspacePath.trim()
    if (!path) {
      setWorkspaceError('Choose the moved Workspace.')
      return
    }
    void run(
      {
        type: 'repair-project-workspace',
        expectedConfigurationVersion: configurationVersion,
        project: project.key,
        workspace: { path },
      },
      `${project.name} Workspace repaired.`,
    )
  }

  const remove = async () => {
    const removed = await run(
      {
        type: 'remove-project',
        expectedConfigurationVersion: configurationVersion,
        project: project.key,
      },
      `${project.name} removed from Roadmap.`,
    )
    if (removed)
      window.location.hash = connectionExists
        ? connectionHash(project.connectionId)
        : connectionSettingsHash
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
                void run(
                  {
                    type: 'refresh-project',
                    expectedConfigurationVersion: configurationVersion,
                    project: project.key,
                  },
                  `${project.name} refreshed.`,
                )
              }
            >
              Refresh now
            </Button>
          </ControlGroup>
        </Surface>
        {project.availability.status === 'unavailable' && (
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
              onClick={() => void remove()}
            >
              Remove project
            </Button>
          </ControlGroup>
        </Modal>
      </SectionBody>
    </Section>
  )
}
