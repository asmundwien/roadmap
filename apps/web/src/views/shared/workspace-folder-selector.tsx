import { Button } from '@roadmap/ui/button'
import classNames from 'classnames/bind'
import { useEffect, useRef, useState } from 'react'
import { useRoadmap } from '@/store/roadmap-provider'
import { type WorkflowAttemptId, type WorkflowScope, workflowFeedback } from '@/workflows/workflows'
import { ErrorText } from './settings-shared'
import { WorkflowFeedback } from './workflow-feedback'
import styles from './workspace-folder-selector.module.css'

const cx = classNames.bind(styles)

type WorkspaceFolderSelectorProps = {
  owner: WorkflowScope
  label: string
  description: string
  path: string
  error?: string
  onChange: (path: string) => void
}

export function WorkspaceFolderSelector({
  owner,
  label,
  description,
  path,
  error,
  onChange,
}: WorkspaceFolderSelectorProps) {
  const { workflows, feedback } = useRoadmap((roadmap) => ({
    workflows: roadmap.workflows,
    feedback: workflowFeedback(roadmap.workflowState, 'select-workspace', { kind: 'none' }, owner),
  }))

  const [selectedAttemptId, setSelectedAttemptId] = useState<WorkflowAttemptId | null>(null)
  const lifetime = useRef<{ ownerKey: string; workflows: typeof workflows } | null>(null)
  const ownerKey = JSON.stringify(owner)

  useEffect(() => {
    const token = { ownerKey, workflows }
    lifetime.current = token
    setSelectedAttemptId(null)
    return () => {
      if (lifetime.current === token) lifetime.current = null
    }
  }, [ownerKey, workflows])

  useEffect(() => {
    const current = feedback.current
    if (
      selectedAttemptId !== null &&
      current?.id === selectedAttemptId &&
      current.kind === 'acknowledged' &&
      current.operation === 'select-workspace' &&
      current.result.kind === 'selected'
    ) {
      setSelectedAttemptId(null)
      onChange(current.result.path)
    }
  }, [selectedAttemptId, feedback.current, onChange])

  const choose = async () => {
    const token = lifetime.current
    if (token === null || token.ownerKey !== ownerKey || token.workflows !== workflows) return
    const attempt = await token.workflows.selectWorkspace({ owner })
    if (
      lifetime.current === token &&
      attempt.kind === 'acknowledged' &&
      attempt.result.kind === 'selected'
    ) {
      setSelectedAttemptId(attempt.id)
    }
  }

  return (
    <fieldset className={cx('settings-folder-field')}>
      <legend>{label}</legend>
      <small>{description}</small>
      <div className={cx('settings-folder-control')}>
        <Button
          size="medium"
          type="button"
          disabled={feedback.blocked || feedback.pending}
          onClick={() => void choose()}
        >
          {feedback.pending ? 'Choosing…' : path ? 'Choose another folder' : 'Choose folder'}
        </Button>
        <output className={cx({ 'is-empty': !path })} aria-live="polite">
          {path || 'No folder selected'}
        </output>
      </div>
      <WorkflowFeedback feedback={feedback} workflows={workflows} />
      <ErrorText error={error ?? null} />
    </fieldset>
  )
}
