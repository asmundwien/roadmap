import type { ProjectRef } from '../projects/registry.ts'

export type HostOperation =
  | { readonly type: 'select-workspace' }
  | {
      readonly type: 'open-workspace'
      readonly project: ProjectRef
      readonly workspacePath: string
    }
  | {
      readonly type: 'open-terminal'
      readonly project: ProjectRef
      readonly workspacePath: string
    }
  | {
      readonly type: 'reveal-source'
      readonly project: ProjectRef
      readonly workspacePath: string
    }

export type WorkspaceSelection =
  | { readonly kind: 'selected'; readonly path: string }
  | { readonly kind: 'cancelled' }
export type HostOperationResult = WorkspaceSelection | { readonly kind: 'invoked' }

export interface HostExecutor {
  execute(operation: HostOperation): Promise<HostOperationResult>
}
