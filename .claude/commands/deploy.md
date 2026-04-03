Deploy the Kilo Energy app to Vercel with Turso production database.

## Pre-deploy checklist
1. Run `npm test` — all tests must pass
2. Run `npx tsc --noEmit` — no type errors
3. Run `npm run build` — production build must succeed
4. Check that `.env` has valid `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`
5. Check that `.env` has valid Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`)

## Deploy steps
1. If any pre-deploy check fails, stop and report the issue
2. If all checks pass, run `npx vercel --prod` (or `npx vercel` for preview)
3. Report the deployment URL

## Post-deploy
1. Verify the deployed app loads by checking the URL
2. Report success or any errors

If Vercel CLI is not installed, install it first with `npm i -g vercel`.
If this is the first deploy, run `npx vercel` interactively first to link the project.
