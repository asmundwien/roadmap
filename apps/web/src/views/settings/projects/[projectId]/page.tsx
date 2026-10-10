import type { ProjectRef } from '@roadmap/contracts/identity'
import { Alert } from '@roadmap/ui/alert'
import { Page, PageEyebrow, PageHeader, PageTitle } from '@roadmap/ui/page'
import classNames from 'classnames/bind'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Link } from '@/navigation'
import { resolveProject } from '@/resources/results'
import { routePaths } from '@/router'
import { useRoadmap } from '@/store/roadmap-provider'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import { type WorkflowAttemptId, workflowFeedback } from '@/workflows/workflows'
import { AutomationSection } from './automation-section'
import { DetailsSection } from './details-section'
import { ManageSection } from './manage-section'
import pageStyles from './page.module.css'

const cx = classNames.bind(pageStyles)

type ProjectSettingsPageProps = { projectRef: ProjectRef }

export function ProjectSettingsPage({ projectRef }: ProjectSettingsPageProps) {
  return (
    <ProjectSettingsDetail
      key={JSON.stringify([projectRef.integration, projectRef.projectId])}
      projectRef={projectRef}
    />
  )
}

function ProjectSettingsDetail({ projectRef }: ProjectSettingsPageProps) {
  const { project, configuration, workflows, removalFeedback, retainedFeedback } = useRoadmap(
    (roadmap) => ({
      project: resolveProject(roadmap, projectRef),
      configuration: roadmap.configuration,
      workflows: roadmap.workflows,
      removalFeedback: workflowFeedback(roadmap.workflowState, 'remove-project', {
        kind: 'project',
        project: projectRef,
      }),
      retainedFeedback: [
        {
          operation: 'rename-project',
          feedback: workflowFeedback(roadmap.workflowState, 'rename-project', {
            kind: 'project',
            project: projectRef,
          }),
        },
        {
          operation: 'repair-project-workspace',
          feedback: workflowFeedback(roadmap.workflowState, 'repair-project-workspace', {
            kind: 'project',
            project: projectRef,
          }),
        },
        {
          operation: 'refresh-project',
          feedback: workflowFeedback(roadmap.workflowState, 'refresh-project', {
            kind: 'project',
            project: projectRef,
          }),
        },
        {
          operation: 'select-workspace',
          feedback: workflowFeedback(
            roadmap.workflowState,
            'select-workspace',
            { kind: 'none' },
            { kind: 'project', project: projectRef },
          ),
        },
      ],
    }),
  )
  const navigate = useNavigate()
  const active = useRef(true)
  const navigationRequest = useRef<symbol | null>(null)
  const [navigationAttempt, setNavigationAttempt] = useState<WorkflowAttemptId | null>(null)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      navigationRequest.current = null
    }
  }, [])
  const remove = async () => {
    const request = Symbol('removal navigation')
    navigationRequest.current = request
    const attempt = await workflows.removeProject({ project: projectRef })
    if (!active.current || navigationRequest.current !== request) return
    setNavigationAttempt(attempt.id)
  }
  useEffect(() => {
    const current = removalFeedback.current
    if (
      !active.current ||
      !navigationAttempt ||
      current?.id !== navigationAttempt ||
      current.kind !== 'acknowledged' ||
      !current.destination
    )
      return
    navigate(current.destination, { replace: true })
  }, [navigationAttempt, removalFeedback.current, navigate])
  const feedback = <WorkflowFeedback feedback={removalFeedback} workflows={workflows} />

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
        {retainedFeedback.map((entry) => (
          <WorkflowFeedback key={entry.operation} feedback={entry.feedback} workflows={workflows} />
        ))}
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
        removalFeedback={removalFeedback}
        onRemove={remove}
      />
    </Page>
  )
}
