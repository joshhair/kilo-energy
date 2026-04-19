# Runbook: Deploy Gating

How CI blocks a bad build from reaching prod on Vercel. The GitHub
Actions `CI` workflow runs on every push and PR; Vercel's Git
integration can be configured to wait for those checks before
promoting a deploy.

---

## What CI runs (`.github/workflows/ci.yml`)

On every `push` to `main` and every `pull_request` targeting `main`:

1. **Typecheck** — `tsc --noEmit`. Blocks on any TypeScript error.
2. **Lint** — `eslint`. Blocks on errors (rules-of-hooks,
   prefer-const, no-var). Warnings are visible in logs but don't block
   — see A+ Phase 1.2 policy.
3. **Unit tests** — `vitest run tests/unit`. ~360 tests covering
   commission math property tests, field-visibility contract, API
   contract tests, form validation.
4. **Production build** — `npm run build`. Catches:
   - Missing imports / undefined exports that only fail at build time
   - Server/client component boundary violations
   - Next.js 16 strict-mode JSX issues
   - Tailwind purge mismatches

A failure in any step marks the check red on the commit/PR.

---

## Vercel Git integration — required setup

Vercel auto-deploys every push to `main` by default. To gate deploys
on CI passing, configure **both** of these:

### 1. Vercel project settings

**Project → Git → Ignored Build Step**

Set the ignored-build-step command to:

```bash
if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then
  # For main: wait for GitHub check status.
  # Vercel won't let GitHub block it directly — easiest reliable
  # gate is the GitHub "Required status checks" rule below.
  exit 1
fi
exit 0
```

(Or simpler: leave Vercel to deploy and rely on GitHub branch
protection + Required status checks — Vercel's "Wait for Checks"
setting, described next, does the actual blocking.)

**Project → Git → Wait for Checks**

Enable **Wait for Checks** (Vercel dashboard → Project → Settings →
Git). This makes Vercel poll GitHub for check statuses before
promoting a Production deploy. If `CI` is red, the deploy either
fails or stays in "Queued" until the check passes.

### 2. GitHub branch protection

**Repo → Settings → Branches → Branch protection rules → `main`**

Enable:
- ☑ **Require status checks to pass before merging**
  - Require branches to be up to date before merging
  - Status checks that are required: **`verify` (from CI workflow)**
- ☑ **Require pull request reviews before merging** (recommended but
  optional — the solo-admin workflow skips this)

This makes direct pushes to `main` with failing checks impossible
(for protected branches — admins can override if strictly needed).

---

## Verifying configuration

Run `npx tsx scripts/verify-deploy-gate.mts` (with `GITHUB_TOKEN`
set) to confirm the GitHub side is configured correctly. The script
checks:

1. `main` branch has branch protection enabled.
2. Required status checks include `verify`.
3. `require_branches_to_be_up_to_date` is true.

It does **not** verify the Vercel "Wait for Checks" toggle (no
public API — dashboard-only). That stays manual.

Exit 0 = GitHub side clean. Exit 1 = gap; follow the setup
instructions above.

---

## What a gated deploy looks like

1. Commit is pushed to `main` (or merged via PR).
2. GitHub triggers the `CI` workflow. Status: pending.
3. Vercel receives the push webhook, enters **"Waiting for Checks"**.
4. CI runs typecheck → lint → unit → build. ~3 minutes total.
5. If CI **passes**: Vercel promotes the deploy to production.
6. If CI **fails**: Vercel cancels the deploy. Prod stays on the
   previous successful build.

---

## Failure modes + recovery

### "Vercel deployed despite CI being red"

- Check Vercel **Wait for Checks** is enabled at the **project**
  level (not just team). Setting is per-project.
- Check GitHub branch protection requires the `verify` check by its
  exact job name (matches `ci.yml` → `jobs.verify`).
- If CI was disabled for a specific commit (skip directive in
  commit message), the gate doesn't apply — fix the commit and
  force a re-run.

### "CI is green but Vercel build still fails"

The CI build step uses dummy env values (`DATABASE_URL=file:...`,
dummy Clerk keys). The prod build uses real env values from Vercel.
This catches *build-time* errors (missing imports, JSX issues) but
not *runtime* config errors (wrong DATABASE_URL format, expired
Clerk keys).

For those: check `Vercel → Deployments → Logs` on the failed build.
Fix the env var on the Vercel side, trigger a redeploy (push a
no-op commit or use the dashboard's "Redeploy" button).

### "CI passes locally but fails in Actions"

- Node version mismatch — CI pins Node 20. `node --version` locally.
- Missing `prisma generate` — CI runs it explicitly; local dev
  usually has a stale generated client.
- Case-sensitive filesystem — Windows/macOS forgive case mismatches
  in imports, Linux (CI) doesn't. Run `npm run typecheck` locally
  first if you renamed files.

---

## Ratchet: what's NOT gated today

The CI gate is the *must-pass* floor. These run separately and can
land red without blocking a deploy:

- **E2E tests** (`tests/e2e/`) — require a running server and a real
  test DB. Run locally before major releases or via `npm run
  test:e2e` in a staging environment.
- **A11y scan** — part of E2E, same story.
- **Load test** — manual workflow-dispatch only; not scheduled.
  See `docs/runbooks/load-testing.md`.

When those mature enough to run reliably in CI, add them to the
gate. For now they're signals, not gates.

---

## Emergency bypass

If prod is broken and you need to ship a hotfix without waiting for
full CI:

1. **Do not** bypass branch protection. Fix-forward is always safer.
2. If CI is stuck (e.g., GitHub Actions outage), you can temporarily
   disable **Wait for Checks** in Vercel, push the fix, then
   **re-enable** immediately after.
3. Document the bypass in the commit message: `EMERGENCY: skipping
   CI due to [reason], retroactively verify by running locally.`
4. Run the full verification gauntlet locally within 24h of the
   bypass and file any issues found.
