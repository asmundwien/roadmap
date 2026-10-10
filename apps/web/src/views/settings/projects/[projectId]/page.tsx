import type { ProjectRef } from '@roadmap/contracts/identity'
import type { CommandResult, SafeError } from '@roadmap/contracts/operations'
import { Alert } from '@roadmap/ui/alert'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Link } from '@/navigation'
import { resolveProject } from '@/resources/results'
import { connectionPath, routePaths } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { ErrorText, projectIdentity } from '@/views/shared/settings-shared'
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
  const { project, configuration, configurationVersion, execute } = useRoadmap((roadmap) => ({
    project: resolveProject(roadmap, projectRef),
    configuration: roadmap.configuration,
    configurationVersion: roadmap.configurationVersion,
    execute: roadmap.execute,
  }))
  const navigate = useNavigate()
  const [removal, setRemoval] = useState<RemovalFeedback | null>(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const remove = async () => {
    if (project.kind === 'missing') return
    const destination = project.connection
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

  if (project.kind === 'missing') {
    return (
      <Page>
        <PageHeader>
          <div>
            <PageEyebrow>Settings / Projects</PageEyebrow>
            <PageTitle>Project not found</PageTitle>
          </div>
        </PageHeader>
        {feedback}
        <Alert>{project.message}</Alert>
        <AutomationSection projectRef={project.ref} />
        <Link href={routePaths.connections}>Back to Connections</Link>
      </Page>
    )
  }

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
      <Alert variant={project.availability.variant === 'info' ? 'info' : undefined}>
        <strong>Project source evidence.</strong>
        <span>{project.availability.message}</span>
      </Alert>
      {project.connection && project.connection.health.status !== 'available' && (
        <Alert>
          <strong>{project.connection.name} is not available.</strong>
          <span>{project.connection.health.cause}</span>
        </Alert>
      )}
      {project.warnings.map((warning) => (
        <Alert key={warning}>{warning}</Alert>
      ))}
      {project.membershipMessage && (
        <Alert variant="info">
          {project.membershipTitle && <strong>{project.membershipTitle}</strong>}
          <span>{project.membershipMessage}</span>
        </Alert>
      )}
      <DetailsSection
        key={`details:${project.ref.integration}:${project.ref.projectId}`}
        project={project}
      />
      <AutomationSection
        key={`automation:${project.ref.integration}:${project.ref.projectId}`}
        projectRef={project.ref}
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
