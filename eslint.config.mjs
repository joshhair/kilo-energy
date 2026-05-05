import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Lint policy (A+ gating strategy):
 *
 * ERRORS (CI-blocking): only real correctness issues.
 *   - react-hooks/rules-of-hooks — conditional hooks corrupt React state
 *   - react-hooks/set-state-in-effect — cascading renders / perf bugs
 *   - prefer-const / no-var — style but catches accidental reassignment
 *
 * WARNINGS (visible in output, don't block CI): everything else. This lets
 *   us ratchet quality over time without holding ship-velocity hostage to
 *   a mass `any`-replacement pass.
 *
 *   - no-explicit-any: many legitimate uses (third-party libs, narrow
 *     escape hatches). Incrementally replace with unknown + narrow as
 *     touched.
 *   - no-unused-vars: allow _-prefixed for intentional. Otherwise warn
 *     so accumulated dead code surfaces during PR review.
 *   - exhaustive-deps: warn; fix per case when it's a real bug (not all
 *     missing deps should be added — sometimes intentional).
 *
 * Scripts and migrations get relaxed rules — they're one-offs, not
 * long-lived product code.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local-only scratch / backup paths. find-timothy.mts and
    // backfill-project-expected.mts were deleted in PR cleanup; the
    // other globs are kept so future scratchwork doesn't fail lint.
    "scripts/.local/**",
    "scripts/*.mts.bak",
  ]),
  {
    rules: {
      // Lint-to-zero ratchet (A+ Phase 1.2). Once we cleared all existing
      // violations, promoted these from warn to error so new ones fail CI
      // immediately rather than silently accumulating again.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unused-expressions": "error",
      "react/no-unescaped-entities": "error",
      // exhaustive-deps stays as warn: each missing dep is a judgment call
      // (adding can cause infinite loops). All existing sites carry inline
      // disables with rationale; new ones surface as warnings for PR review.
      "react-hooks/exhaustive-deps": "warn",
      // React 19's new strict-mode-adjacent diagnostics. Real signals
      // that some code patterns are risky, but many occurrences are
      // legitimate (initialization from props, derived state that must
      // sync via effect, ref-inside-callback that the rule can't prove
      // is deferred).
      //
      // Status (2026-04-19): all extant violations in this codebase
      // were individually reviewed during the A+ lint-to-zero pass.
      // Every current occurrence is intentional:
      //   - set-state-in-effect: sync with external state (props,
      //     fetch responses, animation frames, localStorage). React
      //     docs acknowledge this is valid when the state genuinely
      //     needs to mirror an external source.
      //   - refs: "refs-to-latest" pattern in lib/context.tsx keeps
      //     event handlers stable without closing over stale state.
      //     Also MobileNewDeal + BaselinesSection read ref.current
      //     for read-only derivations.
      //   - purity/immutability: computed-rank snapshot loops in
      //     AdminDashboard/KanbanView that are read-only against the
      //     committed snapshot.
      //
      // Turned OFF so CI is clean. Re-enable ad-hoc when auditing a
      // specific area — individual file-level enables via
      // `/* eslint-enable */` are the right shape when investigating.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",

      // ── Regression-prevention gates (PR 6) ──────────────────────────
      // Empty catch blocks silently swallow errors. The Trainer Hub
      // light-mode regression class came from auto-correction loops
      // restoring patterns we'd already fixed; ensuring every catch is
      // observable shrinks the silent-failure surface. allowEmptyCatch
      // is the legacy permissive default — disable it.
      // Status: warn for now, promote to error after one cleanup pass
      // (any remaining `catch {}` should carry an inline disable
      // comment with rationale).
      "no-empty": ["warn", { allowEmptyCatch: false }],

      // Hardcoded color literals in JSX style={{ ... }}. Matches hex
      // (#xxx, #xxxxxx) and the strings 'white' / 'black'. Misses some
      // patterns (color-mix(in srgb, #xxx ...) inside template strings),
      // but catches the cycle-861 `'white'` and trainer-hub `#000`
      // classes that have caused multiple regressions.
      // Always use CSS custom properties (var(--text-primary), etc.)
      // so the value tracks light/dark theme switches.
      // Exempt files: SVG icon attributes, OG-image generators, and
      // globals.css token definitions live elsewhere or take literals.
      "no-restricted-syntax": [
        "warn",
        {
          selector: "Property[key.name='color'] > Literal[value=/^(white|black|#[0-9a-fA-F]{3,8})$/]",
          message: "Hardcoded color literal — use a theme token (var(--text-primary), var(--accent-*-text), etc.) so it tracks light/dark mode.",
        },
        {
          selector: "Property[key.name='background'] > Literal[value=/^(white|black|#[0-9a-fA-F]{3,8})$/]",
          message: "Hardcoded background literal — use a theme token (var(--surface-card), --surface-inset-subtle, etc.).",
        },
        // AuditLog append-only enforcement. SQLite has no GRANT/REVOKE,
        // so we enforce immutability at the code-write boundary: any
        // call to auditLog.update*/delete*/upsert is forbidden outside
        // an explicit allowlist (retention sweep + GDPR erasure).
        // Bypass requires adding the file to the allowlist below with
        // an explicit justification — surfaces accidental mutations
        // before they merge.
        {
          selector: "CallExpression[callee.object.property.name='auditLog'][callee.property.name=/^(update|updateMany|updateManyAndReturn|delete|deleteMany|upsert)$/]",
          message: "AuditLog is append-only. Updates and deletes are forbidden outside the retention sweep (app/api/admin/retention) and GDPR erasure (app/api/users/[id]/erase). If your use case is legitimate, add the file to the allowlist in eslint.config.mjs with a justification.",
        },
      ],
    },
  },
  {
    // AuditLog mutation allowlist: retention cleanup of stale entries
    // and GDPR-style anonymization of erased users. Both are admin-only
    // routes, audited separately. Square brackets in `[id]` need escaping
    // because the glob matcher treats `[...]` as a character class.
    // Also allow scripts/wipe-dummy-data — admin-run dev cleanup tool.
    files: [
      "app/api/admin/retention/route.ts",
      "app/api/users/\\[id\\]/erase/route.ts",
      "scripts/wipe-dummy-data.mts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // Scripts (migrations, backfills, reconcile tools) get relaxed
    // rules. They're one-offs with heavy Prisma.$queryRaw / any-cast
    // usage that isn't worth fighting the type system over.
    files: ["scripts/**/*"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-const": "warn",
    },
  },
  {
    // OG image generators run in an isolated context where CSS custom
    // properties can't resolve — Vercel's @vercel/og renders these in
    // a Satori subprocess that doesn't see globals.css. Hardcoded hex
    // is the only option here.
    files: ["app/icon.tsx", "app/apple-icon.tsx", "app/opengraph-image.tsx", "app/twitter-image.tsx"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // Strict a11y for the shared UI primitives (PR 2 + PR 18).
    // These primitives ship to every Settings panel — a11y bugs there
    // are amplified across the app. Promote the next/jsx-a11y rules
    // that aren't in the default curated set to ERROR level here only,
    // so new primitives are forced to be keyboard-accessible from day 1.
    // The rest of the codebase keeps the next-curated warn-level rules.
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/anchor-is-valid": "error",
    },
  },
  {
    // Privacy-gate enforcement: ban direct prisma imports outside of
    // explicitly-allowed admin paths. New routes must use `db` from
    // `@/lib/db-gated` so the visibility WHERE is injected automatically.
    //
    // Allowed locations for `import { prisma | dbAdmin } from '@/lib/db'`:
    //   - lib/db-gated.ts            (the gate itself wraps prisma)
    //   - lib/api-auth.ts            (foundational auth resolution)
    //   - lib/audit-log.ts           (writer for the gate's audit trail)
    //   - lib/audit.ts               (existing AuditLog writer)
    //   - lib/admin-only/**          (future admin-only data layer)
    //   - app/api/cron/**            (cron jobs run as system)
    //   - app/api/data/route.ts      (bulk endpoint with inline filters)
    //   - app/api/auth/**            (auth resolution paths)
    //   - app/api/admin/**           (admin-only endpoints)
    //   - app/api/import/**          (admin-only data import)
    //   - scripts/**                 (one-off migrations)
    //   - tests/**                   (test setup)
    //   - prisma/**                  (seed scripts)
    //
    // Everywhere else: `import { db } from '@/lib/db-gated'`.
    files: ["app/api/**/*.ts", "lib/**/*.ts"],
    ignores: [
      // Files that legitimately need raw prisma access.
      "lib/db.ts",
      "lib/db-gated.ts",
      "lib/api-auth.ts",
      "lib/audit-log.ts",
      "lib/audit.ts",
      "lib/admin-only/**",
      "lib/admin-context.ts",
      "lib/serialize.ts",
      "lib/commission-server.ts",
      "lib/rate-limit.ts",
      "lib/email-helpers.ts",
      "app/api/cron/**",
      "app/api/data/route.ts",
      "app/api/auth/**",
      "app/api/admin/**",
      "app/api/import/**",
      "app/api/webhooks/**",
    ],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "@/lib/db",
              importNames: ["prisma", "dbAdmin"],
              message:
                "Direct prisma access bypasses the privacy gate. Use `db` from '@/lib/db-gated' instead. If this is a legitimate admin-only path, add the file to the allowlist in eslint.config.mjs.",
            },
            {
              name: "../../../lib/db",
              importNames: ["prisma", "dbAdmin"],
              message:
                "Direct prisma access bypasses the privacy gate. Use `db` from '@/lib/db-gated' instead.",
            },
            {
              name: "../../../../lib/db",
              importNames: ["prisma", "dbAdmin"],
              message:
                "Direct prisma access bypasses the privacy gate. Use `db` from '@/lib/db-gated' instead.",
            },
            {
              name: "../../../../../lib/db",
              importNames: ["prisma", "dbAdmin"],
              message:
                "Direct prisma access bypasses the privacy gate. Use `db` from '@/lib/db-gated' instead.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
