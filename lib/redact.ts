/**
 * redact.ts — response field-redaction helpers.
 *
 * Prisma `include: { rep: true }` pulls the entire User row, including
 * `email`, `phone`, and `clerkUserId` — PII that nested consumers almost
 * never need. Use `REP_PUBLIC_SELECT` anywhere we `include` a User as a
 * relation on a business object (payroll, reimbursement, project, etc.).
 *
 * The top-level /api/reps and /api/users routes apply their own viewer-
 * aware PII stripping based on role. This helper handles the "relation
 * tucked inside another response" case where that logic can't reach.
 */

/** Prisma `select` for a rep relation — name only, no PII, no flags. */
export const REP_PUBLIC_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
  active: true,
  repType: true,
} as const;
