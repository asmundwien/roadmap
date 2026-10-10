import type { ProjectRef } from '@roadmap/contracts/identity'
import type { CommandResult, SafeError } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Link } from '@/navigation'
import { connectionPath, routePaths } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { resourceMessage, resourceObservation } from '@/views/shared/resource-results'
import { ErrorText, projectIdentity, sameProject } from '@/views/shared/settings-shared'
import { AutomationSection } from './automation-section'
import { DetailsSection } from './details-section'
import { ManageSection } from './manage-section'
import pageStyles from './page.module.css'

const cx = classNames.bind(pageStyles)

type ProjectSettingsPageProps = { projectRef: ProjectRef }

type RemovalFeedback =
  | { kind: 'pending' }
  | { kind: 'unconfirmed'; result: Extract<CommandResult, { type: 'remove-project' }> }
  | { kind: 'error'; error: SafeError | string }

export function ProjectSettingsPage({ projectRef }: ProjectSettingsPageProps) {
  return (
    <ProjectSettingsDetail
      key={JSON.stringify([projectRef.integration, projectRef.projectId])}
      projectRef={projectRef}
    />
  )
}

function ProjectSettingsDetail({ projectRef }: ProjectSettingsPageProps) {
  const { projects, connections, configuration, configurationVersion, execute } = useRoadmap()
  const navigate = useNavigate()
  const [removal, setRemoval] = useState<RemovalFeedback | null>(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const project = projects.find((candidate) => sameProject(candidate.ref, projectRef))
  const remove = async () => {
    if (!project) return
    const destination = connections.some((candidate) => candidate.id === project.connectionId)
      ? connectionPath(project.connectionId)
      : routePaths.connections
    setRemoval({ kind: 'pending' })
    try {
      const outcome = await execute({
        type: 'remove-project',
        expectedConfigurationVersion: configurationVersion,
        project: projectRef,
      })
      if (!active.current) return
      if (!outcome.ok) {
        setRemoval({ kind: 'error', error: outcome.error })
      } else if (outcome.result.commit === 'committed') {
        setRemoval(null)
        navigate(destination, { replace: true })
      } else {
        setRemoval({ kind: 'unconfirmed', result: outcome.result })
      }
    } catch {
      if (active.current)
        setRemoval({
          kind: 'error',
          error: `Registration removal for ${projectIdentity({ ref: projectRef })} may have completed. Check the relevant configuration before retrying.`,
        })
    }
  }
  const feedback =
    removal?.kind === 'pending' ? (
      <Alert variant="info">
        {`Waiting for the registration removal result for ${projectIdentity({ ref: projectRef })}. Current configuration does not confirm this operation's durability.`}
      </Alert>
    ) : removal?.kind === 'unconfirmed' ? (
      <Alert variant="info">
        {`Registration removal committed for ${projectIdentity({ ref: removal.result.project })} at configuration version ${removal.result.configurationVersion}, but durability is unconfirmed. Check configuration before leaving this page or making another change. The source repository, Wayfinder state, and Workspace remain unchanged.`}
      </Alert>
    ) : removal?.kind === 'error' ? (
      <ErrorText error={removal.error} />
    ) : null

  if (!project) {
    return (
      <Page>
        <PageHeader>
          <div>
            <PageEyebrow>Settings / Projects</PageEyebrow>
            <PageTitle>Project not found</PageTitle>
          </div>
        </PageHeader>
        {feedback}
        <Link href={routePaths.connections}>Back to Connections</Link>
      </Page>
    )
  }

  const connection = connections.find((candidate) => candidate.id === project.connectionId)

  return (
    <Page>
      <PageHeader className={cx('project-registration-header')}>
        <div>
          <PageEyebrow>Settings / Projects</PageEyebrow>
          <PageTitle>{project.name}</PageTitle>
        </div>
      </PageHeader>
      {feedback}
      {!configuration.valid && (
        <Alert>
          <strong>Configuration needs repair.</strong>
          <span>In-app changes stay blocked until roadmap.config.json is valid.</span>
        </Alert>
      )}
      <Alert variant={project.resource.kind === 'current-readable' ? 'info' : undefined}>
        <strong>Project source evidence.</strong>
        <span>{resourceMessage(project.resource)}</span>
      </Alert>
      {connection && connection.availability.status !== 'available' && (
        <Alert>
          <strong>{connection.name} is not available.</strong>
          <span>{connection.availability.cause}</span>
        </Alert>
      )}
      {[
        ...(resourceObservation(project.resource)?.value.warnings ?? []),
        ...project.managementWarnings,
      ].map((warning) => (
        <Alert key={warning}>{warning}</Alert>
      ))}
      {project.activeMap.kind === 'uncertain' ? (
        <Alert>
          <strong>Active map is uncertain.</strong>
          <span>{project.activeMap.cause}</span>
        </Alert>
      ) : (
        project.mapsMembership.kind === 'current-complete' &&
        project.mapsMembership.observation.value.members.length === 0 && (
          <Alert variant="info">
            <strong>No current Wayfinder maps.</strong>
            <span>
              Complete current membership contains no maps. Historical resources remain inspectable.
            </span>
          </Alert>
        )
      )}
      <DetailsSection
        key={`details:${project.ref.integration}:${project.ref.projectId}`}
        project={project}
        connection={connection}
      />
      <AutomationSection
        key={`automation:${project.ref.integration}:${project.ref.projectId}`}
        project={project}
      />
      <ManageSection
        key={`manage:${project.ref.integration}:${project.ref.projectId}`}
        project={project}
        removing={removal?.kind === 'pending'}
        onRemove={remove}
      />
    </Page>
  )
}
