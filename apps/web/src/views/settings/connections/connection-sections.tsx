import type { AuthorizationOperation, Connection, RegisteredProject } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { Button, ButtonLink } from '@roadmap/ui/button'
import { Icon, icon } from '@roadmap/ui/icon'
import { Link } from '@roadmap/ui/link'
import {
  Section,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import { useState } from 'react'
import { connectionHash, projectHash, projectImportHash, projectRegistrationHash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { unacknowledgedInterruption } from '@/views/settings/project-automation'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { locatorLabel, projectIdentity, sameProject } from '@/views/shared/settings-shared'
import { authorizationStatus, connectionAvailability } from './connection-details'
import connectionStyles from './connections.module.css'

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
            className={connectionStyles['settings-operation']}
            type="button"
            key={authorization.id}
            onClick={() => onOpenAuthorization(authorization.id)}
          >
            <span>
              <strong>GitHub authorization · {authorizationStatus(authorization)}</strong>
              <small>{authorization.cause ?? 'Open the device authorization progress.'}</small>
            </span>
            <Icon icon={icon.internalLink} />
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
  const { automation } = useRoadmap()
  return (
    <Section>
      <SectionHeader>
        <div className={connectionStyles['connection-title-row']}>
          <SectionTitle>{connection.name}</SectionTitle>
          <IntegrationBadge integration={connection.integration} />
        </div>
        <div className={connectionStyles['connection-manage-link']}>
          <Link href={connectionHash(connection.id)}>Manage connection</Link>
        </div>
        <div className={connectionStyles['connection-import-link']}>
          <ButtonLink href={projectImportHash(connection.id)}>
            <Icon icon={icon.plus} /> Import project
          </ButtonLink>
        </div>
      </SectionHeader>
      <SectionBody>
        {connection.availability.status !== 'available' && (
          <Alert>
            <strong>{connectionAvailability(connection)}</strong>
            <span>{connection.availability.cause}</span>
          </Alert>
        )}
        {dependents.map((project) => {
          const interrupted = unacknowledgedInterruption(project.key, automation.evidence)
          const preferred = automation.enabledProjects.some((key) => sameProject(key, project.key))
          const unavailable = automation.availability.status === 'unavailable'
          return (
            <Surface key={projectIdentity(project)}>
              <div className={connectionStyles['connection-project-title']}>
                <SurfaceTitle>{project.name}</SurfaceTitle>
                {interrupted ? (
                  <strong className={connectionStyles['connection-project-review']}>
                    <Link href={projectRegistrationHash(project.key)}>Automation needs review</Link>
                  </strong>
                ) : preferred ? (
                  <Badge>
                    {unavailable
                      ? 'Automation enabled · unavailable'
                      : !automation.enabled
                        ? 'Automation enabled · paused'
                        : 'Automation enabled'}
                  </Badge>
                ) : null}
              </div>
              <SurfaceDescription>{locatorLabel(project)}</SurfaceDescription>
              <div className={connectionStyles['connection-project-links']}>
                <Link href={projectRegistrationHash(project.key)}>Project settings</Link>
              </div>
              <ProjectLaunchButtons project={project} />
            </Surface>
          )
        })}
        {dependents.length === 0 && <p>No registered Projects use this Connection.</p>}
      </SectionBody>
    </Section>
  )
}

type ProjectLaunchButtonsProps = { project: RegisteredProject }

function ProjectLaunchButtons({ project }: ProjectLaunchButtonsProps) {
  const { configuration, configurationVersion, command, execute } = useRoadmap()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const launch = async (actionId: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await execute({
        type: 'launch-action',
        expectedConfigurationVersion: configurationVersion,
        project: project.key,
        actionId,
      })
      if (!result.ok) setError(result.error.message)
    } catch {
      setError('The server did not confirm the operation. Wait for live state before retrying.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={connectionStyles['connection-project-actions']}>
        <ButtonLink href={projectHash(project.key)} size="small">
          <Icon icon={icon.codeBranch} />
          Go to roadmap
        </ButtonLink>
        {project.actions.map(
          (action) =>
            action.id === 'open-source' &&
            action.kind === 'external-link' &&
            action.href && (
              <ButtonLink
                key={action.id}
                href={action.href}
                size="small"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon icon={icon.github} />
                {action.label}
              </ButtonLink>
            ),
        )}
        {project.actions
          .filter(
            (action) =>
              action.kind === 'server-launch' &&
              (action.id === 'open-workspace' ||
                action.id === 'reveal-source' ||
                action.id === 'open-terminal'),
          )
          .map((action) => (
            <Button
              key={action.id}
              size="small"
              disabled={busy || command.inFlight || !configuration.valid}
              onClick={() => void launch(action.id)}
            >
              {action.id === 'open-workspace' && <Icon icon={icon.vscode} />}
              {action.id === 'reveal-source' && <Icon icon={icon.folderOpen} />}
              {action.id === 'open-terminal' && <Icon icon={icon.terminal} />}
              {action.label}
            </Button>
          ))}
      </div>
      {error && <Alert>{error}</Alert>}
    </>
  )
}
