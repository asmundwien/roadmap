import { createGitHubClient } from '../github/client.ts'
import { readConfig } from '../github/config.ts'
import { createRoadmapStore, type RoadmapSnapshot, type RoadmapStore } from './roadmap-store.ts'

/**
 * The store the app runs on, wired from the Vite env.
 *
 * Missing config is reported *through* the store as an error snapshot rather than by throwing or
 * by a second return shape, so every view consumes one shape no matter what went wrong.
 */
export function createStoreFromEnv(): RoadmapStore {
  const result = readConfig()
  if (!result.ok) return unconfiguredStore(result.message)
  return createRoadmapStore(createGitHubClient(result.config), result.config.user)
}

function unconfiguredStore(message: string): RoadmapStore {
  const snapshot: RoadmapSnapshot = {
    status: 'error',
    projects: [],
    error: message,
    lastUpdatedAt: null,
    rateLimit: null,
    unreachable: [],
  }
  const noop = () => {}
  return {
    subscribe: () => noop,
    getSnapshot: () => snapshot,
    start: () => noop,
    refresh: () => Promise.resolve(),
  }
}
