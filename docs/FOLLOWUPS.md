# Follow-ups — browser steps only you can do

Three tasks that require interactive web auth I can't do from CLI. Each takes ~2 minutes.

---

## 1. Enable branch protection on `main`

Prevents accidental force-push, requires CI green before merge.

1. Open https://github.com/joshhair/kilo-energy/settings/branches
2. Click **Add branch protection rule** (or edit existing)
3. Branch name pattern: `main`
4. Check these boxes:
   - [x] **Require a pull request before merging** → minimum **1 approval** (even solo — forces the PR workflow so CI runs)
   - [x] **Require status checks to pass before merging** → search and add:
     - `Typecheck · Lint · Unit tests` (will appear once the first CI run completes)
   - [x] **Require branches to be up to date before merging**
   - [x] **Require conversation resolution before merging**
   - [x] **Do not allow bypassing the above settings**
5. **Save changes**

Since Kilo uses auto-commit from the agent team direct to main, you may want to:
- Either exempt the agent service account under "Allow specified actors to bypass"
- Or have agents push to a `agents/auto` branch that opens PRs instead

Flag me if you want me to refactor the agent orchestrator to PR-based flow.

---

## 2. Install Renovate GitHub App

Automates dependency PRs. Config already committed in `renovate.json`.

1. Open https://github.com/apps/renovate
2. Click **Install**
3. Choose **Only select repositories** → pick `kilo-energy`
4. Confirm

Renovate will read `renovate.json` and open its first "dependency dashboard" issue within ~5 minutes. First Monday morning after that, you'll get a batch of update PRs.

---

## 3. Create a Sentry project + add DSN to Vercel

Error tracking is scaffolded but dormant until the DSN env var is set.

### Create Sentry project
1. Sign in (or sign up free) at https://sentry.io
2. Create new project → platform **Next.js** → project name `kilo-energy`
3. On the setup page, copy the **DSN** (looks like `https://abc123@o123.ingest.sentry.io/456`)

### Add DSN to Vercel prod env
Run from `C:\Users\Jarvis\Projects\kilo-energy`:

```bash
vercel env add NEXT_PUBLIC_SENTRY_DSN production
# Paste the DSN when prompted
```

Then redeploy (or wait for next push):

```bash
vercel --prod
```

### Verify it works
Visit the deployed site and trigger an intentional error (open `/dashboard/does-not-exist` or throw in a dev component temporarily). Check https://sentry.io/issues — the error should appear within ~1 minute.

---

## Once all three are done

Three green checks:
- [ ] Branch protection active on `main`
- [ ] Renovate opens its dependency dashboard issue
- [ ] First error from prod appears in Sentry

Tell me when you're done and I'll resume with the remaining plan phases (9.1 decimal money, 9.2 Zod, Phase 4 security, etc).
