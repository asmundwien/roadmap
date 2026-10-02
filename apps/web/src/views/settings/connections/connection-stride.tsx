import type { Connection, RegisteredProject } from '@roadmap/contracts'
import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { ButtonLink } from '@roadmap/ui/button'
import { Icon, icon } from '@roadmap/ui/icon'
import { Link } from '@roadmap/ui/link'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { connectionHash, projectImportHash, projectRegistrationHash } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { unacknowledgedInterruption } from '@/views/settings/project-automation'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { locatorLabel, projectIdentity, sameProject } from '@/views/shared/settings-shared'
import { connectionAvailability } from './connection-details'
import styles from './connection-stride.module.css'
import { ProjectLaunchButtons } from './project-launch-buttons'

const cx = classNames.bind(styles)

type ConnectionStrideProps = {
  connection: Connection
  dependents: RegisteredProject[]
}

export function ConnectionStride({ connection, dependents }: ConnectionStrideProps) {
  const { automation } = useRoadmap()
  return (
    <Section>
      <SectionHeader>
        <div className={cx('connection-title-row')}>
          <SectionTitle>{connection.name}</SectionTitle>
          <IntegrationBadge integration={connection.integration} />
        </div>
        <div className={cx('connection-manage-link')}>
          <Link href={connectionHash(connection.id)}>Manage connection</Link>
        </div>
        <div className={cx('connection-import-link')}>
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
              <div className={cx('connection-project-title')}>
                <SurfaceTitle>{project.name}</SurfaceTitle>
                {interrupted ? (
                  <strong className={cx('connection-project-review')}>
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
              <div className={cx('connection-project-links')}>
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
