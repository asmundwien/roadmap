import { createRoadmapStore, type RoadmapStore } from './roadmap-store.ts'

/** Mirrors the server's `DEFAULT_PORT`; set `VITE_ROADMAP_SERVER_URL` if the port moves. */
const DEFAULT_SERVER_URL = 'ws://localhost:8790/ws'

/** The store the app runs on: a socket to the local server, no browser-side credentials at all. */
export function createStoreFromEnv(): RoadmapStore {
  const url = import.meta.env.VITE_ROADMAP_SERVER_URL?.trim() || DEFAULT_SERVER_URL
  return createRoadmapStore(url)
}
