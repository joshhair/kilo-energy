import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Structural guard against the 2026-06-12 prod-wipe incident: abort the
    // run if TURSO_DATABASE_URL points at a remote DB. BOTH entries are
    // REQUIRED — globalSetup fires once in the main process before any worker
    // spawns (hard-stops the run); setupFiles re-checks inside each worker as
    // defense in depth. Removing either weakens the guard. Any `--config`
    // override MUST replicate both, or tests can reach prod.
    globalSetup: ['./tests/setup/no-prod-db-guard.ts'],
    setupFiles: ['./tests/setup/no-prod-db-guard.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'app/api/**'],
    },
  },
});
