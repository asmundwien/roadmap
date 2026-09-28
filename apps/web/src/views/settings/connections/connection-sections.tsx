import type { AuthorizationOperation, Connection, RegisteredProject } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { Link } from '@roadmap/ui/link'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionGroup,
  SectionGroupDescription,
  SectionGroupTitle,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import { connectionHash, projectHash } from '@/router'
import { locatorLabel, projectIdentity } from '@/views/shared/settings-shared'
import { authorizationStatus, connectionAvailability } from './connection-details'

type ConnectionSetupSectionProps = {
  githubAvailable: boolean
  configurationValid: boolean
  configurationNotices: string[]
  notice: string | null
  authorizations: AuthorizationOperation[]
  hasConnections: boolean
  onOpenAuthorization: (operationId: string) => void
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
            className="settings-operation"
            type="button"
            key={authorization.id}
            onClick={() => onOpenAuthorization(authorization.id)}
          >
            <span>
              <strong>GitHub authorization · {authorizationStatus(authorization)}</strong>
              <small>{authorization.cause ?? 'Open the device authorization progress.'}</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
        {!hasConnections && <p>No Connections configured.</p>}
      </SectionBody>
    </Section>
  )
}

type ConnectionStrideProps = {
  connection: Connection
  dependents: RegisteredProject[]
}

export function ConnectionStride({ connection, dependents }: ConnectionStrideProps) {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{connection.name}</SectionTitle>
        <SectionDescription>
          {connection.githubIdentity
            ? `@${connection.githubIdentity.login}`
            : connection.builtIn
              ? 'Built in'
              : 'GitHub'}{' '}
          · {connectionAvailability(connection)} · {dependents.length} registered{' '}
          {dependents.length === 1 ? 'Project' : 'Projects'}
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <div className="connection-group-header">
          {connection.builtIn ? (
            <Badge variant="warning">Built in</Badge>
          ) : (
            <a href={connectionHash(connection.id)} className="connection-manage">
              Manage
            </a>
          )}
        </div>
        {connection.availability.status !== 'available' && (
          <Alert>
            <strong>{connectionAvailability(connection)}</strong>
            <span>{connection.availability.cause}</span>
          </Alert>
        )}
        {dependents.map((project) => (
          <SectionGroup key={projectIdentity(project)}>
            <SectionGroupTitle>{project.name}</SectionGroupTitle>
            <SectionGroupDescription>{locatorLabel(project)}</SectionGroupDescription>
            <Link href={projectHash(project.key)}>Open Project</Link>
          </SectionGroup>
        ))}
        {dependents.length === 0 && <p>No registered Projects use this Connection.</p>}
      </SectionBody>
    </Section>
  )
}
