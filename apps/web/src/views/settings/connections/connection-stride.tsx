import type { Connection, Project } from '@roadmap/contracts/state'
import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { Icon, icon } from '@roadmap/ui/icon'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import { ButtonLink, Link } from '@/navigation'
import { connectionPath, projectImportPath, projectSettingsPath } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { unacknowledgedInterruption } from '@/views/settings/project-automation'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { resourceMessage } from '@/views/shared/resource-results'
import {
  mapState,
  projectIdentity,
  projectSourceLabel,
  sameProject,
} from '@/views/shared/settings-shared'
import { connectionAvailability } from './connection-details'
import styles from './connection-stride.module.css'
import { ProjectLaunchButtons } from './project-launch-buttons'

const cx = classNames.bind(styles)

type ConnectionStrideProps = {
  connection: Connection
  dependents: Project[]
}

export function ConnectionStride({ connection, dependents }: ConnectionStrideProps) {
  const automation = useRoadmap((roadmap) => roadmap.automation)
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
        {connection.availability.status !== 'available' && (
          <Alert>
            <strong>{connectionAvailability(connection)}</strong>
            <span>{connection.availability.cause}</span>
          </Alert>
        )}
        {dependents.map((project) => {
          const interrupted = unacknowledgedInterruption(project.ref, automation.evidence)
          const preferred = automation.enabledProjects.some((key) => sameProject(key, project.ref))
          const unavailable = automation.availability.status === 'unavailable'
          return (
            <Surface key={projectIdentity(project)}>
              <div className={cx('connection-project-title')}>
                <SurfaceTitle>{project.name}</SurfaceTitle>
                {interrupted ? (
                  <strong className={cx('connection-project-review')}>
                    <Link href={projectSettingsPath(project.ref)}>Automation needs review</Link>
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
              <SurfaceDescription>{projectSourceLabel(project)}</SurfaceDescription>
              <SurfaceDescription>{resourceMessage(project.resource)}</SurfaceDescription>
              <SurfaceDescription>{mapState(project)}</SurfaceDescription>
              {project.managementWarnings.map((warning) => (
                <Alert key={warning}>{warning}</Alert>
              ))}
              <div className={cx('connection-project-links')}>
                <Link href={projectSettingsPath(project.ref)}>Project settings</Link>
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
