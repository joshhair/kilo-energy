Quick verification pass — run all tests and type checks to confirm the app is healthy.

1. Run `npx tsc --noEmit` — type check
2. Run `npm run test:unit` — unit tests
3. Run `npm run test:api` — DB integration tests
4. Run `npm run lint` — eslint

Report a one-line summary per step (PASS/FAIL + count) and an overall status.
If anything fails, show the specific errors.
