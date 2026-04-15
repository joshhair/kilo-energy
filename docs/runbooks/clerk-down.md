# Runbook — Clerk (Auth) Down

## Symptoms
- Users can't sign in; `/sign-in` page spins or errors
- Existing sessions still work (Clerk validates JWTs client-side) but new sign-ins fail
- Middleware blocks requests with cryptic 401s
- Vercel logs show `clerkMiddleware` errors or `Clerk: Unable to reach API`

## Diagnosis
```bash
# Check Clerk status
open https://status.clerk.com

# Verify Clerk API reachable from our infra
curl -H "Authorization: Bearer $CLERK_SECRET_KEY" https://api.clerk.com/v1/users?limit=1

# Check env vars present in prod
vercel env ls production | grep -i clerk
```

## Mitigation
1. **If Clerk platform is down** — no workaround for new sign-ins. Post a banner; existing sessions keep working.
2. **If our keys are invalid** — check `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` in Vercel env. Rotate via Clerk dashboard if compromised.
3. **If middleware misconfigured** — check `middleware.ts`. Public route matcher should whitelist `/sign-in`, `/sign-up`, `/api/webhooks`, `/legal/*`.
4. **If specific users locked out** — check Clerk dashboard for banned/restricted accounts.

## Emergency access (admin only)
If auth is totally broken and an admin needs DB access:
```bash
# Direct Turso shell bypasses Clerk entirely
turso db shell kilo-prod
```
Do NOT bypass Clerk in application code as a "fix" — that's a security regression.

## Root cause investigation
- Review `lib/api-auth.ts` — all API routes should call `requireAdmin()` / `requireInternalUser()` / `requireAdminOrPM()`. If any bypassed Clerk, that's a gap.
- Check Clerk webhook handlers in `/api/webhooks/clerk/` — if user sync broke, `clerkUserId` → internal User mapping could drift
- Audit log any `role_change` events from the outage window — was auth compromised?
