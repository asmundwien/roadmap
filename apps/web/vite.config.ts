import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { roadmapArchitectureGraph } from '../../scripts/browser-architecture-plugin.mjs'

// https://vite.dev/config/
export default defineConfig({
  // `.env.local` lives at the repo root, shared with the server, not per-package.
  envDir: '../..',
  plugins: [react(), roadmapArchitectureGraph(fileURLToPath(new URL('../..', import.meta.url)))],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // The data layer is pure functions and fetch; nothing here needs a DOM yet. The first
    // component test that does should add jsdom and Testing Library then, not before.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
