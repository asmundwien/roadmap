import type { Project, WayfinderMap } from '@roadmap/contracts'

/**
 * The map a project leads with. `openMaps` arrives ordered most recently updated first, so the
 * head is the active one; a project with none is resting.
 */
export function activeMapOf(project: Project): WayfinderMap | null {
  return project.openMaps[0] ?? null
}
