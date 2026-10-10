import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { Modal } from '@roadmap/ui/modal'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceTitle } from '@roadmap/ui/surface'
import { type FormEvent, useState } from 'react'
import type { KnownProjectResult } from '@/resources/results'
import { useRoadmap } from '@/store/roadmap-provider'
import { SettingsForm } from '@/views/shared/settings-form'
import { WorkflowFeedback } from '@/views/shared/workflow-feedback'
import { WorkspaceFolderSelector } from '@/views/shared/workspace-folder-selector'
import { type WorkflowFeedbackResult, workflowFeedback } from '@/workflows/workflows'

type ManageSectionProps = {
  project: KnownProjectResult
  removalFeedback: WorkflowFeedbackResult
  onRemove: () => Promise<void>
}

export function ManageSection({ project, removalFeedback, onRemove }: ManageSectionProps) {
  const { workflows, refreshFeedback, repairFeedback, folderFeedback } = useRoadmap((roadmap) => ({
    workflows: roadmap.workflows,
    refreshFeedback: workflowFeedback(roadmap.workflowState, 'refresh-project', {
      kind: 'project',
      project: project.ref,
    }),
    repairFeedback: workflowFeedback(roadmap.workflowState, 'repair-project-workspace', {
      kind: 'project',
      project: project.ref,
    }),
    folderFeedback: workflowFeedback(
      roadmap.workflowState,
      'select-workspace',
      { kind: 'none' },
      { kind: 'project', project: project.ref },
    ),
  }))
  const [workspacePath, setWorkspacePath] = useState('')
  const [confirming, setConfirming] = useState(false)
  const repair = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void workflows.repairWorkspace({ project: project.ref, path: workspacePath })
  }

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Manage project registration</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <WorkflowFeedback feedback={refreshFeedback} workflows={workflows} />
        <WorkflowFeedback feedback={repairFeedback} workflows={workflows} />
        {!project.capabilities.repairOffered && (
          <WorkflowFeedback feedback={folderFeedback} workflows={workflows} />
        )}
        <Surface>
          <SurfaceTitle>Refresh project</SurfaceTitle>
          <p>Check the Project source for current maps and availability.</p>
          <ControlGroup>
            <Button
              type="button"
              disabled={refreshFeedback.blocked || refreshFeedback.pending}
              onClick={() => void workflows.refreshProject({ project: project.ref })}
            >
              Refresh now
            </Button>
          </ControlGroup>
        </Surface>
        {project.capabilities.repairOffered && (
          <Surface>
            <SurfaceTitle>Moved Workspace</SurfaceTitle>
            <p>
              Repair requires proof of the same Project identity. Connection and locator stay
              unchanged.
            </p>
            <SettingsForm onSubmit={repair}>
              <WorkspaceFolderSelector
                label="New Workspace"
                description="Choose the moved folder that contains the same Project."
                path={workspacePath}
                error={repairFeedback.fields.workspace ?? repairFeedback.fields.path}
                owner={{ kind: 'project', project: project.ref }}
                onChange={setWorkspacePath}
              />
              <ControlGroup>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={repairFeedback.blocked || repairFeedback.pending}
                >
                  Validate and repair
                </Button>
              </ControlGroup>
            </SettingsForm>
          </Surface>
        )}
        <Surface>
          <SurfaceTitle>Remove project registration</SurfaceTitle>
          <p>The source repository, Wayfinder state, and Workspace remain unchanged.</p>
          <ControlGroup>
            <Button
              variant="danger"
              type="button"
              disabled={removalFeedback.blocked || removalFeedback.pending}
              onClick={() => setConfirming(true)}
            >
              Remove project registration
            </Button>
          </ControlGroup>
        </Surface>
        <Modal open={confirming} onClose={() => setConfirming(false)} title="Remove project">
          <p>Remove "{project.name}" from Roadmap?</p>
          <ControlGroup>
            <Button
              variant="danger"
              appearance="solid"
              type="button"
              disabled={removalFeedback.blocked || removalFeedback.pending}
              onClick={() => void onRemove()}
            >
              Remove project
            </Button>
          </ControlGroup>
        </Modal>
      </SectionBody>
    </Section>
  )
}
