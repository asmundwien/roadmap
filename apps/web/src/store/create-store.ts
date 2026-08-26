import { createRoadmapStore, type RoadmapStore } from './roadmap-store.ts'

/** Mirrors the server's default HTTP origin; the store derives `/ws` and request endpoints. */
const DEFAULT_SERVER_URL = 'http://localhost:8790'

/** The store the app runs on; credentials remain server-side. */
export function createStoreFromEnv(): RoadmapStore {
  const url = import.meta.env.VITE_ROADMAP_SERVER_URL?.trim() || DEFAULT_SERVER_URL
  return createRoadmapStore(url)
}
