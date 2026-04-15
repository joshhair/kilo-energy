# Runbook — Payroll Publish Didn't Land

## Symptoms
- Admin clicks "Publish" on a payroll period; UI shows success toast but entries stay in Draft
- Rep reports "my M1 still says pending" hours after admin says it was published
- `POST /api/payroll/publish` returns 200 but DB shows `status: "draft"` unchanged

## Diagnosis
```bash
# Check recent payroll writes in the audit log
npx tsx -e "import { prisma } from './lib/db'; const logs = await prisma.auditLog.findMany({ where: { action: 'payroll_publish' }, orderBy: { createdAt: 'desc' }, take: 10 }); console.log(logs);"

# Inspect the affected entry's current state
npx tsx -e "import { prisma } from './lib/db'; const e = await prisma.payrollEntry.findUnique({ where: { id: 'REPLACE_ME' } }); console.log(e);"

# Tail recent Vercel function logs
vercel logs --since 1h | grep -i "payroll\|idempotency"
```

## Mitigation
1. **If idempotency key collision** — an earlier request already won. Check `lib/context/payroll.ts` — a retry with the same `clientId` will return the existing (already-persisted) row. UI should re-fetch to reconcile.
2. **If entry is missing entirely** — the POST was rejected upstream (auth, validation). Check response body for the error; ask admin to retry with fresh page load.
3. **If status didn't flip** — a concurrent write collided. Manually update:
   ```ts
   await prisma.payrollEntry.update({ where: { id }, data: { status: 'paid', paidAt: new Date() } });
   // Then log manually:
   await logChange({ actor: {...}, action: 'payroll_publish_manual', ... });
   ```

## Root cause investigation
- Check `app/api/payroll/route.ts` for exception paths that 200 without persisting
- `lib/context/payroll.ts` — confirm client-side idempotency key generation is fresh per submit
- Re-run commission math tests: `npm test -- tests/unit/commission.test.ts`
- Review StrictMode concurrency — nested setters in `lib/context.tsx` are a known past foot-gun
