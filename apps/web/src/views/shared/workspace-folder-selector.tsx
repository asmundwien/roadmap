import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import classNames from 'classnames/bind'
import { useState } from 'react'
import type { useRoadmap } from '@/store/roadmap-provider'
import { ErrorText } from './settings-shared'
import styles from './workspace-folder-selector.module.css'

const cx = classNames.bind(styles)

type WorkspaceFolderSelectorProps = {
  label: string
  description: string
  path: string
  error?: string
  disabled: boolean
  query: ReturnType<typeof useRoadmap>['query']
  onChange: (path: string) => void
}

type SelectionFeedback =
  | { kind: 'cancelled' }
  | { kind: 'failure' | 'lifecycle' | 'not-admitted' | 'protocol' | 'unknown'; message: string }

export function WorkspaceFolderSelector({
  label,
  description,
  path,
  error,
  disabled,
  query,
  onChange,
}: WorkspaceFolderSelectorProps) {
  const [choosing, setChoosing] = useState(false)
  const [feedback, setFeedback] = useState<SelectionFeedback | null>(null)

  const choose = async () => {
    setChoosing(true)
    setFeedback(null)
    try {
      const outcome = await query({ type: 'select-workspace' })
      if ('kind' in outcome) {
        switch (outcome.kind) {
          case 'not-admitted':
            setFeedback({
              kind: 'not-admitted',
              message: `Folder selection did not begin. ${outcome.error.message}`,
            })
            return
          case 'completion-unknown':
            switch (outcome.reason) {
              case 'protocol':
                setFeedback({
                  kind: 'protocol',
                  message:
                    'The server returned an invalid folder selection response. Completion is unknown; the current folder has not changed.',
                })
                return
              case 'delivery':
                setFeedback({
                  kind: 'unknown',
                  message:
                    'The folder selection response was lost or unreadable. Completion is unknown; the current folder has not changed.',
                })
                return
              default: {
                const exhaustive: never = outcome.reason
                return exhaustive
              }
            }
          default: {
            const exhaustive: never = outcome
            return exhaustive
          }
        }
      }
      if (!outcome.ok) {
        setFeedback({
          kind:
            outcome.error.code === 'admission-failed' || outcome.error.code === 'not-supported'
              ? 'lifecycle'
              : 'failure',
          message:
            outcome.error.code === 'admission-failed' || outcome.error.code === 'not-supported'
              ? `Folder selection is unavailable in the application's current lifecycle. ${outcome.error.message}`
              : `Folder selection failed. ${outcome.error.message}`,
        })
        return
      }
      switch (outcome.result.kind) {
        case 'selected':
          onChange(outcome.result.path)
          return
        case 'cancelled':
          setFeedback({ kind: 'cancelled' })
          return
        default: {
          const exhaustive: never = outcome.result
          return exhaustive
        }
      }
    } catch {
      setFeedback({
        kind: 'unknown',
        message: 'Folder selection completion is unknown. The current folder has not changed.',
      })
    } finally {
      setChoosing(false)
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
          disabled={disabled || choosing}
          onClick={() => void choose()}
        >
          {choosing ? 'Choosing…' : path ? 'Choose another folder' : 'Choose folder'}
        </Button>
        <output className={cx({ 'is-empty': !path })} aria-live="polite">
          {path || 'No folder selected'}
        </output>
      </div>
      {feedback?.kind === 'cancelled' ? (
        <Alert variant="info">
          Folder selection cancelled. The current folder has not changed.
        </Alert>
      ) : feedback ? (
        <ErrorText error={feedback.message} />
      ) : null}
      <ErrorText error={error ?? null} />
    </fieldset>
  )
}
