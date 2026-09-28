import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Components render to static markup, so no DOM is needed. Add jsdom here when a test
    // needs real events.
    environment: 'node',
    // Process CSS so the modules resolve to their real scoped names. Without it every lookup,
    // including a misspelled one, would return a plausible-looking stub and prove nothing.
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
