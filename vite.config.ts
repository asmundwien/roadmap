import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // The data layer is pure functions and fetch; nothing here needs a DOM yet. The first
    // component test that does should add jsdom and Testing Library then, not before.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
