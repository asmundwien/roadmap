import type { Project } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Button, ButtonLink as ExternalButtonLink } from '@roadmap/ui/button'
import { Icon, icon } from '@roadmap/ui/icon'
import classNames from 'classnames/bind'
import { useState } from 'react'
import { ButtonLink } from '@/navigation'
import { useRoadmap } from '@/store/roadmap-provider'
import styles from './project-launch-buttons.module.css'

const cx = classNames.bind(styles)

type ProjectLaunchButtonsProps = { project: Project }
type LaunchAction = Extract<Project['actions'][number], { kind: 'server-launch' }>

export function ProjectLaunchButtons({ project }: ProjectLaunchButtonsProps) {
  const { configuration, configurationVersion, command, execute } = useRoadmap()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const launch = async (action: LaunchAction) => {
    setBusy(true)
    setFeedback(null)
    try {
      const outcome = await execute({
        type: 'launch-project-operation',
        expectedConfigurationVersion: configurationVersion,
        project: action.project,
        operation: action.operation,
      })
      if (!outcome.ok) setFeedback(outcome.error.message)
      else if (outcome.result.status === 'invoked') {
        setFeedback(
          `Host invocation completed for ${outcome.result.project.projectId}. This does not confirm a Session result.`,
        )
      }
    } catch {
      setFeedback(
        'The native invocation outcome is unknown because its reply was lost. Roadmap will not retry it.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={cx('connection-project-actions')}>
        {project.actions.map((action) => {
          switch (action.kind) {
            case 'roadmap':
              return (
                <ButtonLink key={action.id} href={action.href} size="small">
                  <Icon icon={icon.codeBranch} />
                  {action.label}
                </ButtonLink>
              )
            case 'external-link':
              return (
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
              )
            case 'server-launch':
              return (
                <Button
                  key={action.id}
                  size="small"
                  disabled={busy || command.inFlight || !configuration.valid}
                  onClick={() => void launch(action)}
                >
                  {action.operation === 'open-workspace' && <Icon icon={icon.vscode} />}
                  {action.operation === 'reveal-source' && <Icon icon={icon.folderOpen} />}
                  {action.operation === 'open-terminal' && <Icon icon={icon.terminal} />}
                  {action.label}
                </Button>
              )
            default: {
              const exhaustive: never = action
              return exhaustive
            }
          }
        })}
      </div>
      {feedback && (
        <div role="status">
          <Alert>{feedback}</Alert>
        </div>
      )}
    </>
  )
}
