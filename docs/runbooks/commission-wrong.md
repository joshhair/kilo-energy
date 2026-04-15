# Runbook — Commission Amount Is Wrong

## Symptoms
- Rep reports "my M1 is $X but I expected $Y"
- Admin notices a deal's commission doesn't match their spreadsheet
- Payroll total for a period looks off by more than a rounding-worth amount

## Diagnosis
```bash
# Look up the project and recompute commission in isolation
npx tsx -e "
import { prisma } from './lib/db';
import { calculateCommission } from './lib/data';
const p = await prisma.project.findUnique({
  where: { id: 'REPLACE_ME' },
  include: { installer: true, closer: true, setter: true }
});
console.log('Project:', p);
console.log('Recomputed:', calculateCommission({
  installer: p.installer.name,
  soldPPW: p.netPPW,
  kWSize: p.kWSize,
  soldDate: p.soldDate
}));
"

# Check pricing version active on soldDate
npx tsx -e "
import { prisma } from './lib/db';
const versions = await prisma.installerPricingVersion.findMany({
  where: { installerId: 'REPLACE_ME' },
  orderBy: { effectiveDate: 'desc' }
});
console.log(versions);
"
```

## Mitigation
1. **If baseline lookup returned undefined** — no pricing version covers `soldDate`. Add a version record with correct `effectiveDate`. Baseline gaps return `undefined` → NaN → $0 commission silently.
2. **If split percent wrong** — check `setterPct` / `trainerOverridePct` on project. Validate sum ≤ 100%.
3. **If floating-point drift** — commission math uses `Math.round(x * 100) / 100` (Phase 3 hardening). If amount ends in `.9999` the rounding didn't run; re-deploy latest.
4. **If dealer fee adder missing** — `+$0.10/W` setter premium comes from `InstallerPricingTier.setterPerW`. Verify set for that installer.

## Root cause investigation
- `lib/data.ts calculateCommission()` — trace the exact baseline + multiplier chain
- `tests/unit/commission.test.ts` — add a regression test with the specific deal inputs
- `AuditLog` for this project — any `financial_edit` after the sold date?
- Compare `project.m1Amount` (stored) vs. `calculateCommission(...)` (computed). Divergence = stale recomputation.
