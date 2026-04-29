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
 * Compute the WHERE clause that scopes the PayrollEntry table.
 *
 * Policy:
 *   - admin: see all
 *   - internal PM (allowlisted): see all
 *   - vendor PM: NONE (commission is closer/setter financial data; vendor
 *     installer-side staff should never see internal pay)
 *   - misconfigured PM: NONE (default-deny)
 *   - rep / sub-dealer: only their own (repId match)
 *   - unknown role: NONE (default-deny)
 *
 * Mirrors the inline policy in /api/data/route.ts for PayrollEntry —
 * keep these two in lockstep. If you change one, change the other.
 */
export function payrollEntryVisibilityWhere(): Prisma.PayrollEntryWhereInput {
  const user = requireEffectiveUser();

  if (user.role === 'admin') return {};
  if (user.role === 'project_manager' && user.email && isInternalPM(user as Parameters<typeof isInternalPM>[0])) {
    return {};
  }
  if (isVendorPM(user)) {
    return { repId: '__deny_vendor_pm_no_payroll__' };
  }
  if (user.role === 'project_manager') {
    logger.warn('gated_db_default_deny', {
      userId: user.id,
      role: user.role,
      model: 'PayrollEntry',
      reason: 'project_manager without scope or allowlist',
    });
    return { repId: '__deny_misconfigured_pm__' };
  }
  if (user.role === 'rep' || user.role === 'sub-dealer') {
    return { repId: user.id };
  }
  logger.warn('gated_db_default_deny', {
    userId: user.id,
    role: user.role,
    model: 'PayrollEntry',
    reason: 'unknown role',
  });
  return { repId: '__deny_unknown_role__' };
}

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
 * Compute the WHERE clause that scopes Reimbursements. Same shape as
 * PayrollEntry — per-rep, vendor PM denied, default-deny on unknowns.
 */
export function reimbursementVisibilityWhere(): Prisma.ReimbursementWhereInput {
  const user = requireEffectiveUser();
  if (user.role === 'admin') return {};
  if (user.role === 'project_manager' && user.email && isInternalPM(user as Parameters<typeof isInternalPM>[0])) {
    return {};
  }
  if (isVendorPM(user)) return { repId: '__deny_vendor_pm_no_reimb__' };
  if (user.role === 'project_manager') {
    return { repId: '__deny_misconfigured_pm__' };
  }
  if (user.role === 'rep' || user.role === 'sub-dealer') return { repId: user.id };
  logger.warn('gated_db_default_deny', { userId: user.id, role: user.role, model: 'Reimbursement' });
  return { repId: '__deny_unknown_role__' };
}

/**
 * Compute the WHERE for project-scoped child models (ProjectMessage,
 * ProjectActivity, ProjectMention, ProjectAdminNote). The visibility
 * delegates to the parent project's policy: a row is visible iff the
 * containing project is visible.
 *
 * Implemented as a Prisma relational filter `{ project: <projectGate> }`,
 * which Prisma compiles to a JOIN with the project gate's WHERE applied.
 *
 * For ProjectAdminNote, an EXTRA admin/PM check is layered on top —
 * even if the user can see the project, they shouldn't see admin notes
 * unless they're admin or internal PM.
 */
function projectScopedWhere(): { project: Prisma.ProjectWhereInput } {
  return { project: projectVisibilityWhere() };
}

/**
 * ProjectMessage / ProjectActivity / ProjectMention: scoped via parent
 * project. If the user can see the project, they can see its messages /
 * activity / mentions.
 *
 * Note: ProjectActivity additionally filters out financial field_edit
 * entries from non-admin viewers — that's done at the route layer
 * (app/api/projects/[id]/activity/route.ts) since it's a per-row
 * decision based on the meta JSON shape, not a row-level WHERE.
 */
export function projectMessageVisibilityWhere(): Prisma.ProjectMessageWhereInput {
  return projectScopedWhere();
}
export function projectActivityVisibilityWhere(): Prisma.ProjectActivityWhereInput {
  return projectScopedWhere();
}
export function projectNoteVisibilityWhere(): Prisma.ProjectNoteWhereInput {
  return projectScopedWhere();
}
export function projectMentionVisibilityWhere(): Prisma.ProjectMentionWhereInput {
  // Mentions also filter on the message (which lives on a project), but
  // mention rows are per-user, so a user only sees mentions targeted at
  // them in the first place. The gate intersects both: must be a
  // mention for me AND on a project I can see.
  const user = requireEffectiveUser();
  if (user.role === 'admin') return {};
  if (user.role === 'project_manager' && user.email && isInternalPM(user as Parameters<typeof isInternalPM>[0])) {
    return {};
  }
  // Mentions are scoped through the parent ProjectMessage's project.
  // Use a nested relational filter.
  return {
    userId: user.id,
    message: { project: projectVisibilityWhere() },
  };
}

/**
 * BlitzCost: admin + internal PM only. Vendor PMs and reps never see
 * blitz operating costs. Default-deny everywhere else.
 */
export function blitzCostVisibilityWhere(): Prisma.BlitzCostWhereInput {
  const user = requireEffectiveUser();
  if (user.role === 'admin') return {};
  if (user.role === 'project_manager' && user.email && isInternalPM(user as Parameters<typeof isInternalPM>[0])) {
    return {};
  }
  // Everyone else: deny. There's no blitz-cost field that isn't
  // admin-sensitive — operating costs aren't shared with reps or
  // vendor staff.
  return { id: '__deny_non_admin_no_blitz_costs__' };
}

/**
 * ProjectAdminNote: admin + internal PM only. Vendor PMs explicitly
 * blocked even if they can see the project (admin notes about a vendor
 * project shouldn't reach the vendor). Default-deny everyone else.
 */
export function projectAdminNoteVisibilityWhere(): Prisma.ProjectAdminNoteWhereInput {
  const user = requireEffectiveUser();
  if (user.role === 'admin') return {};
  if (user.role === 'project_manager' && user.email && isInternalPM(user as Parameters<typeof isInternalPM>[0])) {
    return {};
  }
  return { id: '__deny_non_admin_no_admin_notes__' };
}

/**
 * Combine the caller's WHERE with the gate's visibility WHERE. Uses AND
 * so the gate is restrictive — a caller can only see records that are
 * BOTH a match for their query AND visible to them.
 *
 * Generic over the WhereInput type so each model's gate composes
 * type-safely.
 */
function intersectWhere<W extends Record<string, unknown>>(
  callerWhere: W | undefined,
  gateWhere: W,
): W {
  if (!callerWhere || Object.keys(callerWhere).length === 0) return gateWhere;
  return { AND: [callerWhere, gateWhere] } as unknown as W;
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
    payrollEntry: {
      async findMany({ args, query }) {
        const gate = payrollEntryVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async findFirst({ args, query }) {
        const gate = payrollEntryVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async findFirstOrThrow({ args, query }) {
        const gate = payrollEntryVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        if (!result) return result;
        const gate = payrollEntryVisibilityWhere();
        const match = await prisma.payrollEntry.findFirst({
          where: { AND: [{ id: result.id }, gate] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async findUniqueOrThrow({ args, query }) {
        const result = await query(args);
        const gate = payrollEntryVisibilityWhere();
        const match = await prisma.payrollEntry.findFirst({
          where: { AND: [{ id: result.id }, gate] },
          select: { id: true },
        });
        if (!match) {
          throw new Error('PayrollEntry not found or not visible to current user');
        }
        return result;
      },
      async count({ args, query }) {
        const gate = payrollEntryVisibilityWhere();
        args = args ?? {};
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async aggregate({ args, query }) {
        const gate = payrollEntryVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
      async groupBy({ args, query }) {
        const gate = payrollEntryVisibilityWhere();
        args.where = intersectWhere(args.where, gate);
        return query(args);
      },
    },
    reimbursement: {
      async findMany({ args, query }) {
        args.where = intersectWhere(args.where, reimbursementVisibilityWhere());
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = intersectWhere(args.where, reimbursementVisibilityWhere());
        return query(args);
      },
      async findFirstOrThrow({ args, query }) {
        args.where = intersectWhere(args.where, reimbursementVisibilityWhere());
        return query(args);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        if (!result) return result;
        const match = await prisma.reimbursement.findFirst({
          where: { AND: [{ id: result.id }, reimbursementVisibilityWhere()] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async count({ args, query }) {
        args = args ?? {};
        args.where = intersectWhere(args.where, reimbursementVisibilityWhere());
        return query(args);
      },
      async aggregate({ args, query }) {
        args.where = intersectWhere(args.where, reimbursementVisibilityWhere());
        return query(args);
      },
    },
    projectMessage: {
      async findMany({ args, query }) {
        args.where = intersectWhere(args.where, projectMessageVisibilityWhere());
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = intersectWhere(args.where, projectMessageVisibilityWhere());
        return query(args);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        if (!result) return result;
        const match = await prisma.projectMessage.findFirst({
          where: { AND: [{ id: result.id }, projectMessageVisibilityWhere()] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async count({ args, query }) {
        args = args ?? {};
        args.where = intersectWhere(args.where, projectMessageVisibilityWhere());
        return query(args);
      },
    },
    projectActivity: {
      async findMany({ args, query }) {
        args.where = intersectWhere(args.where, projectActivityVisibilityWhere());
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = intersectWhere(args.where, projectActivityVisibilityWhere());
        return query(args);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        if (!result) return result;
        const match = await prisma.projectActivity.findFirst({
          where: { AND: [{ id: result.id }, projectActivityVisibilityWhere()] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async count({ args, query }) {
        args = args ?? {};
        args.where = intersectWhere(args.where, projectActivityVisibilityWhere());
        return query(args);
      },
    },
    projectMention: {
      async findMany({ args, query }) {
        args.where = intersectWhere(args.where, projectMentionVisibilityWhere());
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = intersectWhere(args.where, projectMentionVisibilityWhere());
        return query(args);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        if (!result) return result;
        const match = await prisma.projectMention.findFirst({
          where: { AND: [{ id: result.id }, projectMentionVisibilityWhere()] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async count({ args, query }) {
        args = args ?? {};
        args.where = intersectWhere(args.where, projectMentionVisibilityWhere());
        return query(args);
      },
    },
    blitzCost: {
      async findMany({ args, query }) {
        args.where = intersectWhere(args.where, blitzCostVisibilityWhere());
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = intersectWhere(args.where, blitzCostVisibilityWhere());
        return query(args);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        if (!result) return result;
        const match = await prisma.blitzCost.findFirst({
          where: { AND: [{ id: result.id }, blitzCostVisibilityWhere()] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async count({ args, query }) {
        args = args ?? {};
        args.where = intersectWhere(args.where, blitzCostVisibilityWhere());
        return query(args);
      },
      async aggregate({ args, query }) {
        args.where = intersectWhere(args.where, blitzCostVisibilityWhere());
        return query(args);
      },
    },
    projectNote: {
      async findMany({ args, query }) {
        args.where = intersectWhere(args.where, projectNoteVisibilityWhere());
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = intersectWhere(args.where, projectNoteVisibilityWhere());
        return query(args);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        if (!result) return result;
        const match = await prisma.projectNote.findFirst({
          where: { AND: [{ id: result.id }, projectNoteVisibilityWhere()] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async count({ args, query }) {
        args = args ?? {};
        args.where = intersectWhere(args.where, projectNoteVisibilityWhere());
        return query(args);
      },
    },
    projectAdminNote: {
      async findMany({ args, query }) {
        args.where = intersectWhere(args.where, projectAdminNoteVisibilityWhere());
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = intersectWhere(args.where, projectAdminNoteVisibilityWhere());
        return query(args);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        if (!result) return result;
        const match = await prisma.projectAdminNote.findFirst({
          where: { AND: [{ id: result.id }, projectAdminNoteVisibilityWhere()] },
          select: { id: true },
        });
        return match ? result : null;
      },
      async count({ args, query }) {
        args = args ?? {};
        args.where = intersectWhere(args.where, projectAdminNoteVisibilityWhere());
        return query(args);
      },
    },
  },
});

export type GatedDb = typeof db;
