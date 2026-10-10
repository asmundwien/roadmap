import type { ProjectRef } from '@roadmap/contracts/identity'
import { projectOperationSchema } from '@roadmap/contracts/operations'
import type { ProjectAction } from '@roadmap/contracts/state'
import { Button, ButtonLink as ExternalButtonLink } from '@roadmap/ui/button'
import { Icon, icon } from '@roadmap/ui/icon'
import classNames from 'classnames/bind'
import { ButtonLink } from '@/navigation'
import { useRoadmap } from '@/store/roadmap-provider'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import { nativeOperationFeedback, type WorkflowFeedbackResult } from '@/workflows/workflows'
import styles from './project-launch-buttons.module.css'

const cx = classNames.bind(styles)

type ProjectLaunchButtonsProps = { project: ProjectRef; actions: ProjectAction[] }
type LaunchAction = Extract<ProjectAction, { kind: 'server-launch' }>
type ProjectActionView =
  | Exclude<ProjectAction, LaunchAction>
  | { kind: 'server-launch'; action: LaunchAction; feedback: WorkflowFeedbackResult }

export function ProjectLaunchButtons({ project, actions }: ProjectLaunchButtonsProps) {
  const { workflows, actionViews, nativeFeedback } = useRoadmap((roadmap) => ({
    workflows: roadmap.workflows,
    actionViews: actions.map(
      (action): ProjectActionView =>
        action.kind === 'server-launch'
          ? {
              kind: 'server-launch',
              action,
              feedback: nativeOperationFeedback(roadmap.workflowState, {
                project,
                operation: action.operation,
              }),
            }
          : action,
    ),
    nativeFeedback: projectOperationSchema.options.map((operation) => ({
      operation,
      feedback: nativeOperationFeedback(roadmap.workflowState, { project, operation }),
    })),
  }))

  return (
    <>
      <div className={cx('connection-project-actions')}>
        {actionViews.map((view) => {
          switch (view.kind) {
            case 'roadmap':
              return (
                <ButtonLink key={view.id} href={view.href} size="small">
                  <Icon icon={icon.codeBranch} />
                  {view.label}
                </ButtonLink>
              )
            case 'external-link':
              return (
                <ExternalButtonLink
                  key={view.id}
                  href={view.href}
                  size="small"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon icon={icon.github} />
                  {view.label}
                </ExternalButtonLink>
              )
            case 'server-launch':
              return (
                <Button
                  key={view.action.id}
                  size="small"
                  disabled={view.feedback.blocked}
                  aria-busy={view.feedback.pending || undefined}
                  onClick={() =>
                    void workflows.launchProject({
                      project,
                      operation: view.action.operation,
                    })
                  }
                >
                  {view.action.operation === 'open-workspace' && <Icon icon={icon.vscode} />}
                  {view.action.operation === 'reveal-source' && <Icon icon={icon.folderOpen} />}
                  {view.action.operation === 'open-terminal' && <Icon icon={icon.terminal} />}
                  {view.action.label}
                </Button>
              )
            default: {
              const exhaustive: never = view
              return exhaustive
            }
          }
        })}
      </div>
      {nativeFeedback.map(({ operation, feedback }) => (
        <WorkflowFeedback key={operation} feedback={feedback} workflows={workflows} />
      ))}
    </>
  )
}
