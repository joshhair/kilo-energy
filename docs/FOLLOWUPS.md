# Follow-ups

## ✅ 1. Branch protection on `main` — DONE (2026-04-15)

Active rules:
- Force pushes: blocked
- Branch deletions: blocked
- Linear history: required (rebase/squash only)
- Conversation resolution: required

Admin bypass is enabled (Josh can override), and PR/status-check gating is
intentionally off so the agent team's direct-push flow still works.

**Tighten later:** once agents are refactored to a PR-based flow, add:
- `required_pull_request_reviews` with 1 approval
- `required_status_checks` with the `Typecheck · Lint · Unit tests` context

---

## ⏳ 2. Install Renovate GitHub App

Automates dependency PRs. Config already committed in `renovate.json`.

1. Open https://github.com/apps/renovate
2. Click **Install**
3. Choose **Only select repositories** → pick `kilo-energy`
4. Confirm

Renovate will open its "dependency dashboard" issue within ~5 minutes.

---

## ⏳ 3. Create a Sentry project + add DSN to Vercel

Error tracking is scaffolded but dormant until the DSN env var is set.

### Create Sentry project
1. Sign in (or sign up free) at https://sentry.io
2. Create new project → platform **Next.js** → project name `kilo-energy`
3. Copy the **DSN** (looks like `https://abc123@o123.ingest.sentry.io/456`)

### Add DSN to Vercel
Run from `C:\Users\Jarvis\Projects\kilo-energy`:

```bash
vercel env add NEXT_PUBLIC_SENTRY_DSN production
# Paste the DSN when prompted
vercel --prod
```

### Verify
Trigger an error in prod (e.g. throw in a test component or visit a
nonexistent page). Check https://sentry.io/issues within ~1 minute.

---

## Once 2 and 3 are done

Tell me. I'll resume with remaining plan phases (9.1 decimal money, 9.2
Zod, Phase 4 security, etc).
