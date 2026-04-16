# Runbook — Sentry Alert Rules

Sentry already collects errors (via `instrumentation-client.ts` + the
server `instrumentation.ts`), but raw collection is useless without a
notification rule — you'd only know about issues by opening the Sentry
dashboard, which nobody does proactively. This runbook sets up the one
alert that matters: **error spike → email Josh**.

## Pre-flight check

1. Confirm `NEXT_PUBLIC_SENTRY_DSN` is set on Vercel prod env
   (`vercel env ls production`). If not, Sentry isn't initialized and
   alerts have nothing to fire on.
2. Open Sentry: https://sentry.io → project `kilo-energy` (or whatever
   slug was chosen during scaffold). Confirm events are arriving (the
   app has had enough traffic to log at least a handful).

## Alert rule: "Error spike → email"

**Goal:** Josh gets an email within 5 minutes of any error burst
(≥ 10 unhandled errors in a rolling 5-minute window) so he can
investigate before a real user reports it.

**Setup (Sentry web dashboard, ~2 minutes):**

1. Navigate to **Alerts → Create Alert**
2. Select **Issues** (alert on issue-level events, not metrics)
3. Under **Set conditions**:
   - **Environment**: `production`
   - **When**: `An issue is seen more than 10 times in 5m`
     (New Sentry UI: "Number of events in an issue is more than 10")
4. Under **Performance conditions**: leave empty — issues rule is enough.
5. Under **Then perform these actions**:
   - `Send a notification to Member` → `jarvisbyjosh@gmail.com`
   - (Optional) add a Slack channel if/when a Slack workspace exists
6. Under **Alert rule details**:
   - **Name**: `Kilo: prod error burst`
   - **Project**: `kilo-energy`
7. **Save Rule**.

## Second rule (optional): "Any 5xx on prod"

For critical routes, an additional narrower rule reduces the noise
floor:

1. **Conditions**: `event.tag[transaction] startsWith /api/` AND
   `event.level is error`
2. **Filter**: `The issue is first seen in 60m` (so reopens count)
3. **Action**: same email target as above.

Tune once you see real traffic.

## Testing the rule

The cleanest test is to throw a real error on prod:

```ts
// TEMPORARY — add to any route, deploy, hit the URL, then REMOVE
throw new Error('Sentry alert smoke test — safe to ignore');
```

Within ~30 s Sentry receives the event. Within the rule's window
(5 min, configurable), the alert fires and the email lands.

**Remember to remove the throw + redeploy** before going back to
normal ops.

## What the email should look like

A working alert email contains:
- Subject: `[Sentry] Kilo: prod error burst triggered (Error: ...)`
- Body: error class, first/last seen, issue URL, environment.

If the subject says "test" or the environment is `development`, the
wrong DSN is in play — verify prod env vars.

## Runbook cross-links

- Sentry scaffolded in `instrumentation-client.ts` and
  `sentry.server.config.ts` / `sentry.edge.config.ts`.
- If Sentry itself is down, see `docs/runbooks/` — not a blocker for
  app uptime, we just temporarily lose error visibility.
