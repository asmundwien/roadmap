import type { RegisteredProject } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Button, ButtonLink as ExternalButtonLink } from '@roadmap/ui/button'
import { Icon, icon } from '@roadmap/ui/icon'
import classNames from 'classnames/bind'
import { useState } from 'react'
import { ButtonLink } from '@/navigation'
import { projectPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import styles from './project-launch-buttons.module.css'

const cx = classNames.bind(styles)

type ProjectLaunchButtonsProps = { project: RegisteredProject }

export function ProjectLaunchButtons({ project }: ProjectLaunchButtonsProps) {
  const { configuration, configurationVersion, command, execute } = useRoadmap()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const launch = async (actionId: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await execute({
        type: 'launch-action',
        expectedConfigurationVersion: configurationVersion,
        project: project.key,
        actionId,
      })
      if (!result.ok) setError(result.error.message)
    } catch {
      setError('The server did not confirm the operation. Wait for live state before retrying.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={cx('connection-project-actions')}>
        <ButtonLink href={projectPath(project.key)} size="small">
          <Icon icon={icon.codeBranch} />
          Go to roadmap
        </ButtonLink>
        {project.actions.map(
          (action) =>
            action.id === 'open-source' &&
            action.kind === 'external-link' &&
            action.href && (
              <ExternalButtonLink
                key={action.id}
                href={action.href}
                size="small"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon icon={icon.github} />
                {action.label}
              </ExternalButtonLink>
            ),
        )}
        {project.actions
          .filter(
            (action) =>
              action.kind === 'server-launch' &&
              (action.id === 'open-workspace' ||
                action.id === 'reveal-source' ||
                action.id === 'open-terminal'),
          )
          .map((action) => (
            <Button
              key={action.id}
              size="small"
              disabled={busy || command.inFlight || !configuration.valid}
              onClick={() => void launch(action.id)}
            >
              {action.id === 'open-workspace' && <Icon icon={icon.vscode} />}
              {action.id === 'reveal-source' && <Icon icon={icon.folderOpen} />}
              {action.id === 'open-terminal' && <Icon icon={icon.terminal} />}
              {action.label}
            </Button>
          ))}
      </div>
      {error && <Alert>{error}</Alert>}
    </>
  )
}
