/**
 * GET /api/my-pay — the signed-in rep's own pay summary, in integer cents.
 *
 * Read-only, additive. Returns exactly the six hero numbers the web rep
 * dashboard shows (app/dashboard/page.tsx), computed server-side via the
 * shared helpers (lib/my-pay-summary → lib/aggregators + lib/period-
 * projection). Built for the native iOS app, which authenticates with the
 * Clerk session bearer token (same as /api/data).
 *
 * Scope: the caller's OWN data only — payroll where repId = user.id, and
 * the projects they're a party to (the rep branch of /api/data's scoping).
 * Admins who are also selling reps (repType set, e.g. Josh) get their own
 * numbers too — we scope by user.id regardless of role. Only aggregated
 * scalars are returned; no payroll/project rows cross the wire.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalUser, getInternalUserById, loadChainTrainees } from '../../../lib/api-auth';
import { resolveEffectiveUser } from '../../../lib/view-as';
import { prisma } from '../../../lib/db';
import { logger } from '../../../lib/logger';
import { serializePayrollEntry, projectMoneyFromCents, serializeProjectParty, dollarsToCents } from '../../../lib/serialize';
import { computeMyPaySummary, type MyPaySummaryProject } from '../../../lib/my-pay-summary';

const cents = (dollars: number): number => dollarsToCents(dollars) ?? 0;

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireInternalUser();
  } catch (response) {
    return response as NextResponse; // 401 from requireInternalUser
  }

  // View-As (admin impersonation): an admin may fetch another user's summary
  // via ?viewAs={userId}. resolveEffectiveUser is the security boundary —
  // non-admins (or invalid targets) are silently scoped to themselves.
  const { effectiveUser, impersonating } = await resolveEffectiveUser(
    user,
    req.nextUrl.searchParams.get('viewAs'),
    getInternalUserById,
  );
  if (impersonating) {
    logger.info('view_as_read', {
      route: '/api/my-pay',
      actorId: user.id,
      effectiveUserId: effectiveUser.id,
    });
  }
  const repId = effectiveUser.id;

  // The rep's direct trainees — their deals must be in scope so the
  // trainer-override pipeline matches the dashboard (same as /api/data).
  const chainTraineeIds = Array.from(await loadChainTrainees(repId));

  // Scope to the rep's own data. Project scope = the exact rep branch of
  // /api/data: deals the rep is a party to, PLUS their direct trainees'
  // deals (closerId ∈ chainTrainees, unless the trainer was cleared).
  const [projectRows, payrollRows, trainerAssignments, installers] = await Promise.all([
    prisma.project.findMany({
      // (The DB column for the closer is `closerId`; it serializes to
      // `repId` on the wire.)
      where: {
        OR: [
          { closerId: repId },
          { setterId: repId },
          { additionalClosers: { some: { userId: repId } } },
          { additionalSetters: { some: { userId: repId } } },
          { trainerId: repId },
          ...(chainTraineeIds.length > 0
            ? [{ AND: [{ closerId: { in: chainTraineeIds } }, { noChainTrainer: false }] }]
            : []),
        ],
      },
      include: {
        installer: true,
        additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
        additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
      },
    }),
    prisma.payrollEntry.findMany({ where: { repId } }),
    prisma.trainerAssignment.findMany({
      where: { OR: [{ trainerId: repId }, { traineeId: repId }] },
      include: { tiers: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.installer.findMany({ select: { name: true, installPayPct: true } }),
  ]);

  // Serialize cents → dollars (the helpers operate on dollars, same as the
  // client context produced by /api/data). Map only the fields the summary
  // math reads; `repId` mirrors /api/data (= closerId).
  const projects: MyPaySummaryProject[] = projectRows.map((p) => ({
    id: p.id,
    phase: p.phase,
    soldDate: p.soldDate,
    kWSize: p.kWSize,
    installer: p.installer.name,
    repId: p.closerId,
    setterId: p.setterId,
    trainerId: p.trainerId,
    noChainTrainer: p.noChainTrainer,
    m1Paid: p.m1Paid,
    m2Paid: p.m2Paid,
    m3Paid: p.m3Paid,
    ...projectMoneyFromCents(p),
    additionalClosers: p.additionalClosers.map(serializeProjectParty),
    additionalSetters: p.additionalSetters.map(serializeProjectParty),
  }));
  const payroll = payrollRows.map(serializePayrollEntry);

  const installerPayConfigs: Record<string, { installPayPct: number }> = {};
  for (const inst of installers) {
    installerPayConfigs[inst.name] = { installPayPct: inst.installPayPct };
  }

  const summary = computeMyPaySummary({
    payroll,
    projects,
    trainerAssignments,
    installerPayConfigs,
    repId,
    now: new Date(),
  });

  return NextResponse.json({
    nextPayoutCents: summary.nextPayout == null ? null : cents(summary.nextPayout),
    nextPayoutLabel: summary.nextPayoutLabel,
    pendingCents: cents(summary.pending),
    pipelineCents: cents(summary.pipeline),
    lifetimeEarnedCents: cents(summary.lifetimeEarned),
    onPaceCents: cents(summary.onPace),
    onPaceCaption: summary.onPaceCaption,
    // 2026 Cash Forecast (computeCashForecast). total === pipeline + new +
    // paid by construction (non-negative case). Each component ≥ 0.
    cashForecast2026Cents: cents(summary.cashForecast2026),
    cashForecastPipelineCents: cents(summary.cashForecastPipeline),
    cashForecastNewCents: cents(summary.cashForecastNew),
    cashForecastPaidCents: cents(summary.cashForecastPaid),
  });
}
