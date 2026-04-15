# Runbook — Turso (Database) Down or Slow

## Symptoms
- API routes return 500 with `SQLITE_BUSY`, `connection refused`, or Prisma connection errors
- Dashboard pages spin forever, never populate data
- Vercel function logs show repeated `libsql` / `@libsql/client` errors

## Diagnosis
```bash
# Check Turso status page
open https://status.turso.tech

# Test direct DB connectivity
npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});
console.time('ping');
const r = await db.execute('SELECT 1');
console.timeEnd('ping');
console.log(r);
"

# Check if it's a credential issue (401 vs. 5xx)
curl -H "Authorization: Bearer $TURSO_AUTH_TOKEN" "$TURSO_DATABASE_URL"
```

## Mitigation
1. **If Turso platform is down** — wait it out; comms on status page. Post a banner (TODO: implement status banner component) to affected users.
2. **If auth token expired** — rotate via Turso dashboard, update `TURSO_AUTH_TOKEN` in Vercel env, redeploy.
3. **If slow but up** — check current query patterns in `app/api/` for accidental full-table scans. Indexes in `prisma/schema.prisma` should cover hot paths.
4. **If a specific endpoint hangs** — likely a long-running query. Kill the Vercel function: redeploy latest, which recycles workers.

## Root cause investigation
- Capture the failing query from Vercel logs + run `EXPLAIN QUERY PLAN` against Turso shell
- Review Prisma `include` chains — excessive eager loading can explode at scale
- Check recent schema migrations for unintended FK scans
- Turso libSQL has connection pooling — verify `prisma` client is a singleton (`lib/db.ts`)
