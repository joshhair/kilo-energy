# Runbook: Incident Response

Top production failure modes and how to handle each. First rule: if
you're paging yourself at 3am, stay calm — the app survives most
single failures because of the layered defenses. The sections below
are ordered by likelihood, not severity.

For each incident type:
- **Detect**: how you'd notice it (Sentry alert, user email, cron failure)
- **Mitigate**: immediate stop-the-bleeding actions
- **Communicate**: who to tell + sample message
- **Postmortem**: what to record + prevent-mechanism to add

---

## 1. Commission drift detected (reconcile cron fails)

Most likely source. The nightly reconcile cron (`.github/workflows/
reconcile.yml`) flagged a project whose stored M1/M2/M3 doesn't
match what `splitCloserSetterPay` computes.

**Detect**: GitHub Actions email — "Commission reconcile drift check
failed." Artifact attached with the drift report.

**Mitigate**:
1. Download the artifact from the workflow run page.
2. Find the affected project(s) in the "Top N worst drift" section.
3. For each: pull up the project in `/dashboard/projects/[id]`, sanity
   check the stored amounts against what the server WOULD compute
   (hit edit + cancel — the live preview shows server-authoritative).
4. If stored is wrong and computed is right: run
   `scripts/reconcile-project-commission.mts --commit` to fix. Dry-run
   first; eyeball the changes; then --commit.
5. If computed is wrong and stored is right: there's a bug in
   `lib/commission.ts`. Escalate — don't run --commit. This is the
   harder case.

**Communicate**: if any rep was paid based on drifted amounts, tell
them directly. "Hey, we found and corrected a $X error on your
[deal name] commission; your next paycheck will include the
adjustment." Don't hide from reps — trust is the product.

**Postmortem**: write up in `docs/runbooks/incidents/YYYY-MM-DD-drift-
{name}.md`. What edit introduced the drift? Why didn't the PATCH
recompute catch it? Add a test to `tests/unit/commission-invariants.
test.ts` that would fail on the same pattern.

---

## 2. Prod build fails (Vercel deploy broken)

App is still live on the previous deploy; new code isn't shipping.

**Detect**: Vercel email "Deployment failed." GitHub Actions may also
be red if CI caught it first.

**Mitigate**:
1. Go to the Vercel deployments page → inspect the failed build log.
2. Common causes (in order of frequency):
   - TypeScript error (tsconfig is stricter on Vercel than local)
   - Missing env var on the Vercel project (new env var was added
     locally but not pushed to Vercel)
   - Dependency install failure (npm registry blip; retry)
   - Build-time Next.js static-gen error
3. Fix locally. `npm run build` mirrors the Vercel build.
4. Commit + push. Vercel auto-retries.

**Communicate**: usually no one else notices — prod is unchanged.
If the broken commit contained a fix users are waiting for, tell
them it's delayed.

**Postmortem**: if the break was caused by something CI should have
caught, audit why CI missed it (warning-only rule? missing test?).

---

## 3. Turso DB slow or down

Symptoms: pages load slowly; writes time out; Sentry starts filling
with "fetch failed" or "connection refused."

**Detect**: Sentry alert on error rate spike. Or you notice the app
feels sluggish.

**Mitigate**:
1. Check Turso status page: https://status.turso.tech/
2. If Turso is down or degraded: you wait. Put the app in maintenance
   mode via Vercel env var so users see "we're investigating" instead
   of cryptic errors.
3. If Turso is fine but OUR DB is slow: check recent migrations or
   bulk-import scripts. A missing index on a hot query column can
   tank perf.
4. Worst case (Turso goes hard-down): restore the latest backup into
   a new Turso DB, point `TURSO_DATABASE_URL` at it via Vercel env,
   redeploy.

**Communicate**: if >5 minutes of degraded performance, send a short
message to reps via the channel they use ("App is slow; we're on
it — updates soon").

**Postmortem**: was it our fault (slow query, missing index)? Add
an index + query profile test. Was it Turso's fault? Document the
failure mode + our response time.

---

## 4. Clerk auth failures

Users can't log in; new invites bounce; existing sessions expire.

**Detect**: Sentry sees auth errors; users email you directly.

**Mitigate**:
1. Check Clerk status: https://status.clerk.com/
2. If Clerk is down: wait. There's no app-level workaround; Clerk is
   the auth layer.
3. If only NEW invites are failing: check if we've hit Clerk's
   org member limit (unlikely but possible with many reps). May
   need to upgrade the Clerk plan.
4. If existing sessions are being rejected: either Clerk key rotated
   without us updating `CLERK_SECRET_KEY` in Vercel, or we have a
   cookie domain issue. Check env vars first.

**Communicate**: can't email users if their email is in Clerk and
they can't log in. Use phone/text for reps.

**Postmortem**: secrets rotation schedule — Clerk keys should be
rotated on a cadence. Document the rotation procedure as an add-on
runbook.

---

## 5. Vercel Blob (receipt uploads) failing

New reimbursement receipts fail to upload. Existing receipts still
viewable.

**Detect**: Users report "can't upload receipt." Sentry sees
`vercel_blob_put_failed` errors.

**Mitigate**:
1. The preflight check in `app/api/reimbursements/[id]/receipt/
   route.ts` returns a clear "not configured" error if
   `BLOB_READ_WRITE_TOKEN` is missing. Verify it's still set in
   Vercel env.
2. If token is valid but uploads still failing: check Vercel Blob
   status. Blob outage → users continue without receipts; app still
   works (the reimbursement row gets created, just no attached
   file).
3. If a specific user's upload fails: check file size (10MB limit)
   + MIME type (image/pdf only).

**Communicate**: "Receipt upload is temporarily down. Please submit
the reimbursement without the receipt and email the receipt
separately; we'll attach it on our side."

**Postmortem**: do we have a fallback path (email-in receipt)? Worth
building if Blob outages become a recurring pattern.

---

## Maintenance mode

To put the app in maintenance mode (stop new writes, display a
friendly "we're down" page):

1. In Vercel project settings → Environment Variables, set
   `NEXT_PUBLIC_MAINTENANCE_MODE=1` for Production.
2. Redeploy (hit "Redeploy" on the latest prod deployment).
3. The app's root layout checks this flag and renders a maintenance
   page instead of normal routes. (Requires implementing the flag
   check in layout.tsx — **not yet built**; add when needed.)

**TODO**: wire up `NEXT_PUBLIC_MAINTENANCE_MODE` detection in
`app/dashboard/layout.tsx` so this runbook entry is actionable. Add
before next high-risk operation.

---

## Postmortem template

Copy this to `docs/runbooks/incidents/YYYY-MM-DD-{slug}.md` after
every P0/P1 incident:

```markdown
# Incident: {summary}

- **Date**: YYYY-MM-DD
- **Detected**: HH:MM UTC (how: …)
- **Resolved**: HH:MM UTC
- **Duration**: N minutes
- **Severity**: P0/P1/P2
- **Blast radius**: N users affected, $M at risk (if money)

## Timeline
- HH:MM: event
- HH:MM: next event
- …

## Root cause
…

## What went well
…

## What went wrong
…

## Action items
- [ ] Add test covering this pattern (link to test file)
- [ ] Add runbook entry if not covered (link)
- [ ] Add alert so future occurrence pages sooner (link)
- [ ] …

## Lessons
Brief.
```

No blameless postmortem performance — just the facts, what to change,
what to leave alone. The goal is preventing recurrence, not
documenting for audit.
