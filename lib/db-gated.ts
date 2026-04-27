/**
 * Privacy-gated Prisma client.
 *
 * Wraps the existing Prisma client with a query extension that injects
 * WHERE clauses for sensitive models based on the current request user
 * (read from AsyncLocalStorage via lib/request-context.ts).
 *
 * **Use this client by default.** Import `db` from `lib/db-gated.ts` in
 * every route that touches sensitive data. The gate enforces visibility
 * rules at the data-access layer, so even a future endpoint that
 * forgets to filter manually still returns only data the user is
 * allowed to see.
 *
 * For explicit admin-only paths (cron jobs, migrations, audit-log
 * writers), import `dbAdmin` from `lib/db.ts` instead. That client
 * skips the extension and returns raw rows.
 *
 * The gate currently covers: Project. Phases 3+ extend it to PayrollEntry,
 * Reimbursement, ProjectMessage, ProjectActivity, Mention, BlitzCost,
 * AdminNote. Each model is added one at a time with integration tests
 * that prove the gate enforces the policy across every fixture user.
 *
 * **What the gate does NOT do:**
 *  - It does not scrub fields (financial column zeroing). That's still
 *    the job of `scrubProjectForViewer()` in lib/serialize.ts.
 *  - It does not check ownership for writes. Mutations go through the
 *    existing `requireProjectAccess()` / `userCanAccessProject()` paths.
 *  - It does not catch raw SQL via `$queryRaw` — that bypass is
 *    intentional for migration scripts and is banned everywhere else
 *    via lint (Phase 4).
 *
 * **Failure mode if context is missing:** the extension throws
 * `No request context bound`. That's louder than silently exposing
 * data. Wrap your handler with `withRequestContext()` or — if it's
 * a legitimate admin path — use `dbAdmin`.
 */

import { Prisma } from './generated/prisma/client';
import { prisma } from './db';
import { requireEffectiveUser, getRequestContext } from './request-context';
import { isVendorPM, isInternalPM } from './api-auth';
import { logger } from './logger';

/**
 * Compute the WHERE clause that scopes the Project table to what the
 * current effective user is allowed to see.
 *
 * This MUST match the policy in /api/data/route.ts. The two are kept in
 * sync deliberately: /api/data builds it inline so today's bulk endpoint
 * doesn't depend on the extension being present, and this function does
 * the same thing for every other Project read going through `db`.
 *
 * Default-deny: any user shape that doesn't match a known role gets
 * `{ id: '__deny_unknown_role__' }`, which returns zero rows.
 */
export function projectVisibilityWhere(): Prisma.ProjectWhereInput {
  const user = requireEffectiveUser();
  const ctx = getRequestContext();
  const chainTraineeIds = ctx?.chainTraineeIds ?? [];

  if (user.role === 'admin') return {};
  // Internal PM allowlist needs the email; for view-as we don't have it,
  // so a view-as'd PM can never be treated as internal. That's the safe
  // default — view-as should never UPGRADE permissions.
  if (user.role === 'project_manager' && user.email && isInternalPM(user as Parameters<typeof isInternalPM>[0])) {
    return {};
  }
  if (isVendorPM(user)) {
    return { installerId: user.scopedInstallerId! };
  }
  if (user.role === 'project_manager') {
    // Misconfigured PM (no scope, not on allowlist): explicit deny.
    logger.warn('gated_db_default_deny', {
      userId: user.id,
      role: user.role,
      reason: 'project_manager without scope or allowlist',
    });
    return { id: '__deny_misconfigured_pm__' };
  }
  if (user.role === 'rep') {
    return {
      OR: [
        { closerId: user.id },
        { setterId: user.id },
        { additionalClosers: { some: { userId: user.id } } },
        { additionalSetters: { some: { userId: user.id } } },
        { trainerId: user.id },
        ...(chainTraineeIds.length > 0 ? [{ closerId: { in: [...chainTraineeIds] } }] : []),
      ],
    };
  }
  if (user.role === 'sub-dealer') {
    return { OR: [{ subDealerId: user.id }, { closerId: user.id }] };
  }
  // Default deny — unknown role / null / unexpected shape.
  logger.warn('gated_db_default_deny', {
    userId: user.id,
    role: user.role,
    reason: 'unknown role',
  });
  return { id: '__deny_unknown_role__' };
}

/**
 * Combine the caller's WHERE with the gate's visibility WHERE. Uses AND
 * so the gate is restrictive — a caller can only see records that are
 * BOTH a match for their query AND visible to them.
 */
function intersectWhere<T extends Prisma.ProjectWhereInput | undefined>(
  callerWhere: T,
  gateWhere: Prisma.ProjectWhereInput,
): Prisma.ProjectWhereInput {
  if (!callerWhere || Object.keys(callerWhere).length === 0) return gateWhere;
  return { AND: [callerWhere, gateWhere] };
}

/**
 * Project query gate. Wraps findMany / findFirst / findUnique / count /
 * aggregate / groupBy.
 *
 * findUnique gets special handling: Prisma's findUnique signature only
 * accepts unique-key wheres, not arbitrary AND combinators, so we
 * post-filter — fetch the row, then check it against the gate's WHERE
 * via a follow-up findFirst. Slightly less efficient but correct.
 */
export const db = prisma.$extends({
  name: 'privacyGate',
  query: {
    project: {
      async findMany({ args, query }) {
        const gate = projectVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async findFirst({ args, query }) {
        const gate = projectVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async findFirstOrThrow({ args, query }) {
        const gate = projectVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async findUnique({ args, query }) {
        // findUnique can't accept arbitrary where clauses — post-filter.
        const result = await query(args);
        if (!result) return result;
        const gate = projectVisibilityWhere();
        const match = await prisma.project.findFirst({
          where: { AND: [{ id: result.id }, gate] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async findUniqueOrThrow({ args, query }) {
        const result = await query(args);
        const gate = projectVisibilityWhere();
        const match = await prisma.project.findFirst({
          where: { AND: [{ id: result.id }, gate] },
          select: { id: true },
        });
        if (!match) {
          throw new Error('Project not found or not visible to current user');
        }
        return result;
      },
      async count({ args, query }) {
        const gate = projectVisibilityWhere();
        args = args ?? {};
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async aggregate({ args, query }) {
        const gate = projectVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async groupBy({ args, query }) {
        const gate = projectVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
    },
  },
});

export type GatedDb = typeof db;
