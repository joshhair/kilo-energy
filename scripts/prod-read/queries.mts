/**
 * scripts/prod-read/queries.mts — Named, reviewed read-only queries.
 *
 * Every query verification phases need is a function here. No raw SQL,
 * no `where` builders accepted from callers. New queries get added with
 * a comment block explaining what phase uses them.
 *
 * Returns are minimal — only the fields the consumer actually needs —
 * so prod-read snapshots don't accidentally hoard PII.
 */

import { readDb, logQuery } from './index.mts';

// ─── Smoke test (Phase 0.5) ─────────────────────────────────────────────────

/** Cheapest possible query — confirms connectivity + read-only wrapping. */
export async function smokeCheck() {
  const count = await readDb.user.count();
  logQuery('user.count', {}, count);
  return { userCount: count };
}

// ─── Rep pipeline (Phase 3 math sanity, Phase 5 smoke) ──────────────────────

/**
 * Active in-flight projects for a rep, role-aware. Returns the same shape
 * as lib/aggregators.ts PipelineProject (cents → dollars via the / 100 in
 * the consumer; here we return raw fields).
 */
export async function getRepPipeline(repId: string) {
  const projects = await readDb.project.findMany({
    where: {
      OR: [
        { closerId: repId },
        { setterId: repId },
        { additionalClosers: { some: { userId: repId } } },
        { additionalSetters: { some: { userId: repId } } },
      ],
      phase: { notIn: ['Cancelled', 'Completed'] },
    },
    select: {
      id: true,
      customerName: true,
      phase: true,
      soldDate: true,
      kWSize: true,
      closerId: true,
      setterId: true,
      m1AmountCents: true,
      m2AmountCents: true,
      m3AmountCents: true,
      setterM1AmountCents: true,
      setterM2AmountCents: true,
      setterM3AmountCents: true,
      additionalClosers: {
        where: { userId: repId },
        select: { userId: true, m1AmountCents: true, m2AmountCents: true, m3AmountCents: true },
      },
      additionalSetters: {
        where: { userId: repId },
        select: { userId: true, m1AmountCents: true, m2AmountCents: true, m3AmountCents: true },
      },
    },
  });
  logQuery('getRepPipeline', { repId }, projects.length);
  return projects;
}

// ─── Rep paid history (Phase 3) ─────────────────────────────────────────────

/**
 * All Paid PayrollEntries for a rep since `sinceDate` (inclusive). Used
 * for paceRate / trailing earnings / YTD-paid components.
 */
export async function getRepPaidHistory(repId: string, sinceDate: string) {
  const entries = await readDb.payrollEntry.findMany({
    where: {
      repId,
      status: 'Paid',
      paidAt: { gte: new Date(`${sinceDate}T00:00:00Z`) },
    },
    select: {
      id: true,
      amountCents: true,
      type: true,
      paymentStage: true,
      status: true,
      paidAt: true,
      projectId: true,
    },
    orderBy: { paidAt: 'asc' },
  });
  logQuery('getRepPaidHistory', { repId, sinceDate }, entries.length);
  return entries;
}

// ─── Rep roster (Phase 5: pick view-as targets across tiers) ────────────────

/** All active reps with first deal date, total deal count, and role flag. */
export async function getRepsOverview() {
  const reps = await readDb.user.findMany({
    where: { active: { not: false } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      repType: true,
      createdAt: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  logQuery('getRepsOverview', {}, reps.length);
  return reps;
}

// ─── Blitz snapshot (Phase 5: completed + active + with-pending sample) ─────

/**
 * Blitzes with participants + costs + attributed project IDs. Used for the
 * smoke matrix to find one of each: active blitz, completed blitz, blitz
 * with pending joins. We don't fetch full project bodies here — just enough
 * to navigate to them in the UI.
 */
export async function getBlitzSummaries() {
  const blitzes = await readDb.blitz.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      ownerId: true,
      participants: { select: { userId: true, joinStatus: true } },
      costs: { select: { amountCents: true } },
      projects: { select: { id: true, phase: true } },
    },
  });
  logQuery('getBlitzSummaries', {}, blitzes.length);
  return blitzes;
}

// ─── Schema sanity (Phase 0.5) ──────────────────────────────────────────────

/** Counts every relevant table. Useful baseline for "did anything change?". */
export async function getRowCounts() {
  const [users, projects, payroll, blitzes] = await Promise.all([
    readDb.user.count(),
    readDb.project.count(),
    readDb.payrollEntry.count(),
    readDb.blitz.count().catch(() => -1), // -1 if Blitz table doesn't exist yet
  ]);
  const result = { users, projects, payroll, blitzes };
  logQuery('getRowCounts', {}, Object.values(result).reduce((a, b) => a + Math.max(0, b), 0));
  return result;
}
