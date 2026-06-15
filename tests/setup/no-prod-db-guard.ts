/**
 * vitest entry for the no-remote-DB guard (2026-06-12 incident).
 *
 * Wired in vitest.config.ts as BOTH globalSetup and setupFiles:
 *   - imported as a setupFile → the module-level call below runs in each
 *     worker before any test file is imported (defense in depth);
 *   - imported as globalSetup → vitest calls the default export once in the
 *     main process before workers spawn (the primary hard-stop).
 *
 * The actual logic lives in ./db-guard.ts (pure, no side effects) so other
 * callers — e.g. Playwright global setup — can reuse the guards without
 * importing this side-effecting module. See the incident write-up: the API
 * suite ran against prod because TURSO_DATABASE_URL was sourced from .env,
 * and a test cleanup with an undefined where emptied PayrollEntry.
 */
import { assertNoRemoteDb } from './db-guard';

// setupFile path: assert on import, inside each worker.
assertNoRemoteDb('setupFile');

// globalSetup path: vitest invokes this once before workers spawn.
export default function globalSetup(): void {
  assertNoRemoteDb('globalSetup');
}
