import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { Icon, icon } from '@roadmap/ui/icon'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { ButtonLink, Link } from '@/navigation'
import type { ConnectionResult } from '@/resources/results'
import { connectionPath, projectImportPath, projectSettingsPath, ticketPath } from '@/router'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import styles from './connection-stride.module.css'
import { ProjectLaunchButtons } from './project-launch-buttons'

const cx = classNames.bind(styles)
type ConnectionStrideProps = { connection: Extract<ConnectionResult, { kind: 'known' }> }

export function ConnectionStride({ connection }: ConnectionStrideProps) {
  return (
    <Section>
      <SectionHeader>
        <div className={cx('connection-title-row')}>
          <SectionTitle>{connection.name}</SectionTitle>
          <IntegrationBadge integration={connection.integration} />
        </div>
        <div className={cx('connection-manage-link')}>
          <Link href={connectionPath(connection.id)}>Manage connection</Link>
        </div>
        <div className={cx('connection-import-link')}>
          <ButtonLink href={projectImportPath(connection.id)}>
            <Icon icon={icon.plus} /> Import project
          </ButtonLink>
        </div>
      </SectionHeader>
      <SectionBody>
        {connection.health.status !== 'available' && (
          <Alert>
            <strong>{connection.health.label}</strong>
            <span>{connection.health.cause}</span>
          </Alert>
        )}
        {connection.projects.map((project) => (
          <Surface key={project.key}>
            <div className={cx('connection-project-title')}>
              <SurfaceTitle>{project.name}</SurfaceTitle>
              {project.automation.reviewRequired ? (
                <strong className={cx('connection-project-review')}>
                  <Link href={projectSettingsPath(project.ref)}>Automation needs review</Link>
                </strong>
              ) : project.automation.projectEnabled ? (
                <Badge>
                  {project.automation.availability.status === 'unavailable'
                    ? 'Automation enabled · unavailable'
                    : !project.automation.enabled
                      ? 'Automation enabled · paused'
                      : 'Automation enabled'}
                </Badge>
              ) : null}
            </div>
            <SurfaceDescription>{project.locator}</SurfaceDescription>
            <SurfaceDescription>{project.availability.message}</SurfaceDescription>
            <SurfaceDescription>{project.mapState}</SurfaceDescription>
            {project.warnings.map((warning) => (
              <Alert key={warning}>{warning}</Alert>
            ))}
            {project.automation.interruptions.map((interruption) => (
              <Alert key={ticketPath(interruption.target)}>
                <span>{interruption.reason}</span>
                <Link href={ticketPath(interruption.target)}>Review interrupted Session</Link>
              </Alert>
            ))}
            <div className={cx('connection-project-links')}>
              <Link href={projectSettingsPath(project.ref)}>Project settings</Link>
            </div>
            <ProjectLaunchButtons actions={project.capabilities.actions} />
          </Surface>
        ))}
        {connection.projectCount === 0 && <p>No registered Projects use this Connection.</p>}
      </SectionBody>
    </Section>
  )
}
