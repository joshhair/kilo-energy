# Privacy Gate — Migration & Maintenance Guide

Read this before adding any API endpoint that touches a sensitive model.

## Sensitive models

These tables contain data that not every user is allowed to see:

| Model                    | Why sensitive                                              |
| ------------------------ | ---------------------------------------------------------- |
| `Project`                | Customer PII, commission, cross-rep visibility             |
| `PayrollEntry`           | Per-rep financial data                                     |
| `Reimbursement`          | Per-rep financial data                                     |
| `ProjectMessage`         | Private chat between deal participants                     |
| `ProjectActivity`        | Audit trail with financial change history                  |
| `ProjectMention`         | Cross-references private chat                              |
| `ProjectNote`            | Per-project notes (rep-visible, project-scoped)            |
| `BlitzCost`              | Operating costs (admin-only)                               |
| `ProjectAdminNote`       | Admin/PM annotations                                       |
| `ProjectFile`            | Utility bills + installer docs (PII; installer-surface)    |
| `ProjectSurveyLink`      | Site-survey photo links (installer-surface)                |
| `ProjectInstallerNote`   | Per-installer ops notes (installer-surface)                |
| `EmailDelivery`          | Handoff email delivery records (installer-surface)         |

13 sensitive models gated as of 2026-04-28.

If a route touches one of these, **it must go through the gate**.

**Audience policies:**

- *Per-rep* models (`PayrollEntry`, `Reimbursement`) — scoped by `repId` to the calling user; vendor PMs explicitly denied.
- *Project-scoped* models (`ProjectMessage`, `ProjectActivity`, `ProjectMention`, `ProjectNote`) — visibility delegated to parent project; reps see their own deals' rows.
- *Admin-only* models (`BlitzCost`, `ProjectAdminNote`) — admin + internal PM only; vendor PMs blocked even if they can see the project.
- *Installer-surface* models (`ProjectFile`, `ProjectSurveyLink`, `ProjectInstallerNote`, `EmailDelivery`) — admin + internal PM + vendor PM whose `scopedInstallerId` matches the project's `installerId`. **Reps DENY** (these are operational comms between Kilo and the installer, not rep-facing). Implemented via shared helper `installerSurfaceProjectWhere()` in `lib/db-gated.ts`.

## Two clients

```ts
// Filtered. Default everywhere.
import { db } from '@/lib/db-gated';

// Unfiltered. Admin-only paths only.
import { dbAdmin } from '@/lib/db';
```

The gated `db` client injects WHERE clauses on every query for sensitive
models, scoping the result to what the request user is allowed to see.
Any query made *without* a request context bound throws — that's the
load-bearing assertion. Forgetting to wrap a handler is a runtime error
in dev, not a silent broadcast in prod.

`dbAdmin` is the explicit unfiltered alias. Use it ONLY in:
- Cron jobs (`app/api/cron/**`)
- Migration scripts (`scripts/**`)
- The audit-log writer (`lib/audit-log.ts`)
- Bulk endpoints that build their own per-role WHERE inline
  (`app/api/data/route.ts`)

The lint rule (Phase 4) restricts `dbAdmin` to those paths.

## Migration pattern for an existing route

Take this old shape:

```ts
import { prisma } from '@/lib/db';
import { requireInternalUser, userCanAccessProject } from '@/lib/api-auth';

export async function GET(req, { params }) {
  const user = await requireInternalUser();
  const { id } = await params;
  if (!await userCanAccessProject(user, id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const project = await prisma.project.findUnique({ where: { id } });
  return NextResponse.json(project);
}
```

Migrate to:

```ts
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { logDataAccess } from '@/lib/audit-log';

export const GET = withApiHandler(async (req, { params }) => {
  const { id } = await params!;
  // The gate handles visibility — findUnique returns null if the user
  // shouldn't see this project. No manual access check needed.
  const project = await db.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await logDataAccess({
    route: '/api/projects/[id]',
    modelName: 'Project',
    recordIds: [project.id],
  });
  return NextResponse.json(project);
});
```

Key changes:
1. Import `db` from `@/lib/db-gated` instead of `prisma` from `@/lib/db`.
2. Wrap the handler with `withApiHandler` — this resolves the user,
   loads chainTrainees once, binds the request context, and handles
   `?viewAs=` for admin impersonation.
3. Drop `userCanAccessProject` (gate handles it).
4. Call `logDataAccess` after the response is built. Fire-and-forget;
   never `await` it on the hot path.

## Adding a new sensitive model to the gate

Today the gate only covers `Project`. To extend it (Phase 3+):

1. **Define the visibility policy** as a pure WHERE-builder function:
   ```ts
   export function payrollEntryVisibilityWhere(): Prisma.PayrollEntryWhereInput {
     const user = requireEffectiveUser();
     if (user.role === 'admin') return {};
     // ... per-role rules
     return { id: '__deny_unknown_role__' }; // default-deny
   }
   ```
2. **Add the policy to `lib/db-gated.ts`** in the `$extends({ query: { payrollEntry: { ... } }})` block. Cover findMany, findFirst, findUnique, count, aggregate, groupBy.
3. **Write unit tests** in `tests/unit/privacy-gate-<model>.test.ts` using the same shape as `privacy-gate-project.test.ts`. Cover every role + default-deny.
4. **Migrate every route** that touches the model to import `db` instead of `prisma`. Each migrated route must include a privacy test in `tests/privacy/`.
5. **Verify the inline filters in `/api/data`** match the new gate policy. They should be identical — drift between the two is the bug class we're trying to eliminate.

## What the gate does NOT do

- **Field scrubbing.** The gate filters which *rows* a user can see. It doesn't zero out individual columns. That's still `scrubProjectForViewer()` in `lib/serialize.ts`.
- **Write authorization.** The gate works on reads. Mutations still go through `userCanAccessProject` / role checks at the route layer.
- **Raw SQL.** `$queryRaw` bypasses the extension. The lint rule bans it outside `lib/admin-only/` and migrations.

## Failure modes & debugging

**"No request context bound"** at runtime = a handler used `db` without
being wrapped with `withApiHandler`. Either wrap it, or use `dbAdmin`
if it's a legitimate admin path.

**Query returns zero rows where you expected data** = the gate's
visibility WHERE is intersecting your caller WHERE with AND. Add
`logger.info('gate_where', { gate: projectVisibilityWhere() })` to see
what the gate is computing for the current user.

**Performance concern** = the gate adds AND clauses that the DB has
to evaluate. Postgres / SQLite indexes on `installerId`, `closerId`,
`subDealerId`, `setterId` already cover the common cases. If you see
slow queries, EXPLAIN and add an index — don't skip the gate.

## Default-deny invariant

Any unknown user shape returns `{ id: '__deny_unknown_role__' }`,
which is an impossible ID and yields zero rows. This is the structural
property that prevents the Joe-Dale-class leak: a misconfigured user,
a typo'd role, a future role added to the User table without updating
the gate — all return empty, not everything. The default-deny test
case in `tests/unit/privacy-gate-project.test.ts` is load-bearing.
Don't relax it.
