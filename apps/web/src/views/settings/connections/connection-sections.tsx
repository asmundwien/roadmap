import type { AuthorizationOperationId } from '@roadmap/contracts/identity'
import type { AuthorizationOperation } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Icon, icon } from '@roadmap/ui/icon'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import classNames from 'classnames/bind'
import {
  type AuthorizationResultFeedback,
  authorizationPhaseStatus,
  authorizationStatus,
} from './connection-details'
import connectionStyles from './connection-sections.module.css'

const cx = classNames.bind(connectionStyles)

type ConnectionSetupSectionProps = {
  githubAvailable: boolean
  configurationValid: boolean
  configurationNotices: string[]
  notice: string | null
  authorizations: AuthorizationOperation[]
  feedback: AuthorizationResultFeedback[]
  hasConnections: boolean
  onOpenAuthorization: (operationId: AuthorizationOperationId) => void
}

export function ConnectionSetupSection({
  githubAvailable,
  configurationValid,
  configurationNotices,
  notice,
  authorizations,
  feedback,
  hasConnections,
  onOpenAuthorization,
}: ConnectionSetupSectionProps) {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Connection setup</SectionTitle>
        <SectionDescription>
          Authorization and configuration for new Connections.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        {!githubAvailable && (
          <Alert>
            <strong>GitHub Connections are unavailable.</strong>
            <span>Configure the Roadmap GitHub App to authorize GitHub accounts.</span>
          </Alert>
        )}
        {!configurationValid && (
          <Alert>
            <strong>Configuration needs repair.</strong>
            <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
          </Alert>
        )}
        {configurationNotices.map((message) => (
          <Alert variant="info" key={message}>
            {message}
          </Alert>
        ))}
        {notice && <Alert variant="info">{notice}</Alert>}
        {authorizations
          .filter(
            (authorization) =>
              !feedback.some((item) => item.result.operationId === authorization.id),
          )
          .map((authorization) => (
            <button
              className={cx('settings-operation')}
              type="button"
              key={authorization.id}
              onClick={() => onOpenAuthorization(authorization.id)}
            >
              <span>
                <strong>GitHub authorization · {authorizationStatus(authorization)}</strong>
                <small>
                  {('cause' in authorization ? authorization.cause : undefined) ??
                    'Open the device authorization progress.'}
                </small>
              </span>
              <Icon icon={icon.internalLink} />
            </button>
          ))}
        {feedback.map(({ result }) => (
          <button
            className={cx('settings-operation')}
            type="button"
            key={result.operationId}
            onClick={() => onOpenAuthorization(result.operationId)}
          >
            <span>
              <strong>GitHub authorization · {authorizationPhaseStatus(result.phase)}</strong>
              <small>
                {result.phase === 'failed' || result.phase === 'denied'
                  ? result.error.message
                  : result.phase === 'granted'
                    ? `Connection ${result.connection.connectionId}, account ${result.connection.accountId}, configuration version ${result.configurationVersion}.`
                    : 'Open the returned authorization phase.'}
              </small>
              <small>The live authorization read has not published its next phase yet.</small>
            </span>
            <Icon icon={icon.internalLink} />
          </button>
        ))}
        {!hasConnections && <p>No Connections configured.</p>}
      </SectionBody>
    </Section>
  )
}
