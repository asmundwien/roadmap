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
import { authorizationStatus } from './connection-details'
import connectionStyles from './connection-sections.module.css'

const cx = classNames.bind(connectionStyles)

type ConnectionSetupSectionProps = {
  githubAvailable: boolean
  configurationValid: boolean
  configurationNotices: string[]
  notice: string | null
  authorizations: AuthorizationOperation[]
  hasConnections: boolean
  onOpenAuthorization: (operationId: AuthorizationOperationId) => void
}

export function ConnectionSetupSection({
  githubAvailable,
  configurationValid,
  configurationNotices,
  notice,
  authorizations,
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
        {authorizations.map((authorization) => (
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
        {!hasConnections && <p>No Connections configured.</p>}
      </SectionBody>
    </Section>
  )
}
