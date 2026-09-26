import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Components render to static markup, so no DOM is needed. Add jsdom here when a test
    // needs real events.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
