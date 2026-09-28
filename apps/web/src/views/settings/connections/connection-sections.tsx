import type { AuthorizationOperation, Connection, RegisteredProject } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Link } from '@roadmap/ui/link'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import { connectionHash, projectHash, projectImportHash, projectRegistrationHash } from '@/router'
import { IntegrationBadge } from '@/views/shared/integration-badge'
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
        <div className="connection-title-row">
          <SectionTitle>{connection.name}</SectionTitle>
          <IntegrationBadge integration={connection.integration} />
        </div>
        <div className="connection-manage-link">
          <Link href={connectionHash(connection.id)}>Manage connection</Link>
        </div>
        <div className="connection-import-link">
          <a className="connection-import-button" href={projectImportHash(connection.id)}>
            <span aria-hidden="true">+</span> Import project
          </a>
        </div>
      </SectionHeader>
      <SectionBody>
        {connection.availability.status !== 'available' && (
          <Alert>
            <strong>{connectionAvailability(connection)}</strong>
            <span>{connection.availability.cause}</span>
          </Alert>
        )}
        {dependents.map((project) => (
          <Surface key={projectIdentity(project)}>
            <SurfaceTitle>{project.name}</SurfaceTitle>
            <SurfaceDescription>{locatorLabel(project)}</SurfaceDescription>
            <div className="connection-project-links">
              <Link href={projectHash(project.key)}>Go to roadmap</Link>
              <Link href={projectRegistrationHash(project.key)}>Manage project registration</Link>
            </div>
          </Surface>
        ))}
        {dependents.length === 0 && <p>No registered Projects use this Connection.</p>}
      </SectionBody>
    </Section>
  )
}
