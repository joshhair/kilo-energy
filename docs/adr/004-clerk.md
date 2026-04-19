# ADR 004 — Clerk for authentication

**Date**: 2026-04-02
**Status**: Accepted

## Context

We need auth with: social login (Google at minimum), password-less
sign-in via email, org-style user management, an admin dashboard
for user invites, and good Next.js integration.

## Decision

Clerk for all auth. Email+password, Google OAuth, magic links. User
records live in Clerk; our Prisma `User` table mirrors via
`publicMetadata.internalUserId`. Clerk's middleware validates every
request.

## Alternatives considered

1. **NextAuth (Auth.js)** — free, more DIY. Higher maintenance
   burden (session management, email sender, password flows).
   Clerk trades recurring cost for zero ongoing work.

2. **Roll our own auth** — no.

3. **Supabase Auth** — if we'd picked Supabase for the DB too, this
   would pair naturally. We didn't, so it'd be an awkward graft.

## Consequences

- User creation/deactivation flows go through Clerk's API first
  (source of truth for auth state), then reflect to our DB.
- `lib/api-auth.ts` wraps `auth()` + `currentUser()` from
  `@clerk/nextjs/server` into `requireAdmin()` / `requireAdminOrPM()`
  / `requireInternalUser()` helpers that every API route uses.
- Rotating Clerk secret keys requires updating Vercel env vars.
  Session cookies remain valid across rotation as long as
  `CLERK_SECRET_KEY` is valid at the moment of verification.
- If Clerk is down, we're down. No fallback path. Documented in
  `docs/runbooks/incidents.md`.
