import type { ActionId } from '@roadmap/contracts/identity'
import type { Project } from '@roadmap/contracts/state'
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

type ProjectLaunchButtonsProps = { project: Project }

export function ProjectLaunchButtons({ project }: ProjectLaunchButtonsProps) {
  const { configuration, configurationVersion, command, execute } = useRoadmap()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const launch = async (actionId: ActionId) => {
    setBusy(true)
    setError(null)
    try {
      const result = await execute({
        type: 'launch-action',
        expectedConfigurationVersion: configurationVersion,
        project: project.ref,
        actionId,
      })
      if (!result.ok) setError(result.error.message)
    } catch {
      setError(
        'The native action may have completed. Roadmap cannot verify a lost launch reply; retrying may repeat it.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={cx('connection-project-actions')}>
        <ButtonLink href={projectPath(project.ref)} size="small">
          <Icon icon={icon.codeBranch} />
          Go to roadmap
        </ButtonLink>
        {project.actions.map(
          (action) =>
            action.kind === 'external-link' && (
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
          .filter((action) => action.kind === 'server-launch')
          .map((action) => (
            <Button
              key={action.id}
              size="small"
              disabled={busy || command.inFlight || !configuration.valid}
              onClick={() => void launch(action.id)}
            >
              {action.operation === 'open-workspace' && <Icon icon={icon.vscode} />}
              {action.operation === 'reveal-source' && <Icon icon={icon.folderOpen} />}
              {action.operation === 'open-terminal' && <Icon icon={icon.terminal} />}
              {action.label}
            </Button>
          ))}
      </div>
      {error && <Alert>{error}</Alert>}
    </>
  )
}
