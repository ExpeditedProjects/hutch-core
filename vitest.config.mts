import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
        },
      },
      {
        // Integration tests hit real network endpoints (MinIO); happy-dom's
        // browser-emulating fetch corrupts SigV4-signed requests, so these
        // run in the plain node environment.
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
        },
      },
    ],
  },
})
