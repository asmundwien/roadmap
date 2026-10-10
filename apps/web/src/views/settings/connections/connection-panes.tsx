import type { AuthorizationOperationId } from '@roadmap/contracts/identity'
import type { AuthorizationOperation } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Link } from '@roadmap/ui/link'
import { Modal } from '@roadmap/ui/modal'
import { TextInput } from '@roadmap/ui/text-input'
import classNames from 'classnames/bind'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link as InternalLink } from '@/navigation'
import type { AuthorizationResult } from '@/resources/results'
import { connectionPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { AuthorizationControls, DeviceCode } from '@/views/shared/authorization-presentation'
import { SettingsForm } from '@/views/shared/settings-form'
import { SettingsFormActions } from '@/views/shared/settings-form-actions'
import { ErrorText } from '@/views/shared/settings-shared'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import {
  type AuthorizationPhaseResult,
  type AuthorizationResultFeedback,
  authorizationPhaseStatus,
  type WorkflowAttemptId,
  type WorkflowFeedbackResult,
  workflowFeedback,
} from '@/workflows/workflows'
import styles from './connection-panes.module.css'

const cx = classNames.bind(styles)

type AddConnectionPaneProps = {
  onClose: () => void
  onResult: (
    result: Extract<AuthorizationPhaseResult, { type: 'begin-github-authorization' }>,
  ) => void
}

export function AddConnectionPane({ onClose, onResult }: AddConnectionPaneProps) {
  const { workflows, feedback } = useRoadmap((roadmap) => ({
    workflows: roadmap.workflows,
    feedback: workflowFeedback(roadmap.workflowState, 'begin-github-authorization', {
      kind: 'none',
    }),
  }))
  const [name, setName] = useState('')
  const [submittedAttemptId, setSubmittedAttemptId] = useState<WorkflowAttemptId | null>(null)
  const presentationRequest = useRef(0)
  useEffect(
    () => () => {
      presentationRequest.current += 1
    },
    [],
  )
  useEffect(() => {
    const attempt = feedback.current
    if (
      submittedAttemptId !== null &&
      attempt?.id === submittedAttemptId &&
      attempt.kind === 'acknowledged' &&
      attempt.operation === 'begin-github-authorization'
    ) {
      setSubmittedAttemptId(null)
      onResult(attempt.result)
    }
  }, [feedback.current, submittedAttemptId, onResult])
  const close = () => {
    presentationRequest.current += 1
    setSubmittedAttemptId(null)
    onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const request = ++presentationRequest.current
    setSubmittedAttemptId(null)
    const attempt = await workflows.beginAuthorization({ name })
    if (request === presentationRequest.current && attempt.kind === 'acknowledged') {
      setSubmittedAttemptId(attempt.id)
    }
  }

  return (
    <Modal open title="Add GitHub Connection" onClose={close}>
      <header className={cx('settings-flow-head')}>
        <p className={cx('settings-eyebrow')}>GitHub Connection</p>
        <h2>Authorize GitHub</h2>
        <p>Use a name that distinguishes this account from other GitHub Connections.</p>
      </header>
      <SettingsForm onSubmit={(event) => void submit(event)}>
        <label htmlFor="connection-name">
          Connection name
          <TextInput
            id="connection-name"
            name="name"
            placeholder="Personal GitHub"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            aria-invalid={Boolean(feedback.fields.name)}
          />
          {feedback.fields.name && <small>{feedback.fields.name}</small>}
        </label>
        <Alert variant="info">
          Credentials are saved in macOS Keychain. They never enter roadmap.config.json or the
          browser.
        </Alert>
        <WorkflowFeedback feedback={feedback} workflows={workflows} />
        <SettingsFormActions>
          <Button type="button" onClick={close}>
            Close
          </Button>
          <Button variant="primary" type="submit" disabled={feedback.blocked || feedback.pending}>
            {feedback.pending ? 'Starting…' : 'Start authorization'}
          </Button>
        </SettingsFormActions>
      </SettingsForm>
    </Modal>
  )
}
type AuthorizationPaneProps = {
  operationId: AuthorizationOperationId
  authorization: AuthorizationOperation | undefined
  presentation: AuthorizationResult | null
  feedback: AuthorizationResultFeedback | null
  beginFeedback: WorkflowFeedbackResult | null
  onClose: () => void
}

export function AuthorizationPane({
  operationId,
  authorization,
  presentation,
  feedback,
  beginFeedback,
  onClose,
}: AuthorizationPaneProps) {
  const { workflows, retryFeedback, cancelFeedback } = useRoadmap((roadmap) => ({
    workflows: roadmap.workflows,
    retryFeedback: workflowFeedback(roadmap.workflowState, 'retry-github-authorization', {
      kind: 'authorization',
      operationId,
    }),
    cancelFeedback: workflowFeedback(roadmap.workflowState, 'cancel-github-authorization', {
      kind: 'authorization',
      operationId,
    }),
  }))
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const unpublished = feedback !== null && !feedback.consumed
  const result = feedback?.result
  const phase =
    unpublished && result
      ? result.phase
      : presentation?.kind === 'terminal'
        ? presentation.outcome
        : presentation?.kind === 'granted-current' || presentation?.kind === 'granted-historical'
          ? 'granted'
          : presentation?.kind
  const waiting =
    unpublished && result?.phase === 'waiting'
      ? result
      : presentation?.kind === 'waiting' && phase === 'waiting'
        ? presentation
        : null
  const phaseError = !unpublished && presentation?.kind === 'terminal' ? presentation.cause : null

  return (
    <Modal open title="GitHub authorization" onClose={onClose}>
      <header className={cx('settings-flow-head')}>
        <p className={cx('settings-eyebrow')}>Device authorization</p>
        <h2>{phase ? authorizationPhaseStatus(phase) : 'Waiting for authorization publication'}</h2>
        <p>
          GitHub authorization progress is live server state. Closing this pane does not cancel it.
        </p>
      </header>
      {unpublished && authorization && <p>{`Live authorization read: ${presentation?.label}.`}</p>}

      {unpublished && (
        <Alert variant="info">
          This operation returned the phase below. The live authorization read has not published its
          next phase yet. Connection availability still comes from live server state.
        </Alert>
      )}

      {waiting && (
        <>
          <DeviceCode>
            <small>{waiting.verificationUri}</small>
            <strong>{waiting.userCode}</strong>
            <span>{`Expires ${new Date(waiting.expiresAt).toLocaleTimeString()}`}</span>
          </DeviceCode>
          <AuthorizationControls>
            <Link href={waiting.verificationUri} external>
              Open GitHub
            </Link>
            <ControlGroup>
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(waiting.userCode)
                    .then(() => setCopiedCode(waiting.userCode))
                }}
              >
                {copiedCode === waiting.userCode ? 'Code copied' : 'Copy code'}
              </Button>
              <Button
                type="button"
                disabled={cancelFeedback.blocked || cancelFeedback.pending}
                onClick={() => void workflows.cancelAuthorization({ operationId })}
              >
                Cancel authorization
              </Button>
            </ControlGroup>
          </AuthorizationControls>
        </>
      )}

      {phase === 'granted' && (
        <Alert variant="info">
          <strong>GitHub authorized.</strong>
          {presentation?.kind === 'granted-current' && !unpublished ? (
            <span>
              {`Connection ${presentation.navigation.connection}, account ${presentation.accountId}. `}
              <InternalLink href={connectionPath(presentation.navigation.connection)}>
                View granted Connection
              </InternalLink>
            </span>
          ) : null}
          <span>
            {presentation?.kind === 'granted-historical' && !unpublished
              ? presentation.message
              : 'This grant does not establish Project source availability.'}
          </span>
        </Alert>
      )}
      {(phase === 'cancelled' || phase === 'expired') && (
        <Alert variant="info">
          <strong>{authorizationPhaseStatus(phase)}</strong>
          <span>Closing or cancelling authorization does not revoke a completed grant.</span>
        </Alert>
      )}
      <ErrorText error={phaseError} />
      {beginFeedback && <WorkflowFeedback feedback={beginFeedback} workflows={workflows} />}
      <WorkflowFeedback feedback={retryFeedback} workflows={workflows} />
      <WorkflowFeedback feedback={cancelFeedback} workflows={workflows} />

      {phase !== 'waiting' && (
        <SettingsFormActions>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
          {phase && phase !== 'granted' && (
            <Button
              type="button"
              disabled={retryFeedback.blocked || retryFeedback.pending}
              onClick={() => void workflows.retryAuthorization({ operationId })}
            >
              Retry authorization
            </Button>
          )}
        </SettingsFormActions>
      )}
    </Modal>
  )
}
