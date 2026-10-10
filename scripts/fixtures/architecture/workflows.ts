import type { ConnectionId, ProjectRef } from '@roadmap/contracts/identity'
import type { Command, OperationSubject } from '@roadmap/contracts/operations'
import type { ReadyApplicationState } from '@roadmap/contracts/state'
import type { RequestRejection } from '@roadmap/contracts/wire'
import { connectionPath, projectSettingsPath } from '@/router'
import {
  type RoadmapWorkflows,
  type WorkflowAttempt,
  type WorkflowOperation,
  type WorkflowSnapshot,
  workflowFeedback,
} from '@/workflows/workflows'

export function projectWorkflow(
  workflows: RoadmapWorkflows,
  state: WorkflowSnapshot,
  project: ProjectRef,
  name: string,
) {
  const operation: WorkflowOperation = 'rename-project'
  const subject: OperationSubject = { kind: 'project', project }
  return {
    feedback: workflowFeedback(state, operation, subject),
    attempt: workflows.renameProject({ project, name }),
    destination: projectSettingsPath(project),
  }
}

export function connectionWorkflow(
  workflows: RoadmapWorkflows,
  connectionId: ConnectionId,
  name: string,
) {
  return {
    attempt: workflows.renameConnection({ connectionId, name }),
    destination: connectionPath(connectionId),
  }
}

export function registrationWorkflow(
  workflows: RoadmapWorkflows,
  candidate: Extract<Command, { type: 'register-project' }>['candidate'],
) {
  return workflows.registerProject({ candidate })
}

export function selectionWorkflow(
  workflows: RoadmapWorkflows,
  state: WorkflowSnapshot,
  owner: Extract<OperationSubject, { kind: 'project' | 'registration' }>,
) {
  return {
    feedback: workflowFeedback(state, 'select-workspace', { kind: 'none' }, owner),
    attempt: workflows.selectWorkspace({ owner }),
  }
}

export function publicWorkflowState(
  read: Pick<ReadyApplicationState, 'configurationVersion' | 'projects'>,
  state: WorkflowSnapshot,
): { read: typeof read; attempts: readonly WorkflowAttempt[] } {
  return { read, attempts: state.attempts }
}

export type AttributableRejection = RequestRejection
