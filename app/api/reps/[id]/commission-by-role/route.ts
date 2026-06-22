import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser, getInternalUserById, isInternalPM } from '../../../../../lib/api-auth';
import { resolveEffectiveUser } from '../../../../../lib/view-as';
import { commissionByRole } from '../../../../../lib/commission-by-role';
import { logger } from '../../../../../lib/logger';

// GET /api/reps/[id]/commission-by-role
// Commission grouped by the rep's role on each deal (Closer / Co-closer /
// Setter / Trainer / Bonus), split paid vs pending in integer cents — the
// single source of truth for the native iOS rep profile's "Commission by
// role" section. The classification mirrors app/dashboard/mobile/
// MobileRepDetail.tsx, which shares the same classifier (lib/commission-by-
// role.ts), so the web and the app can't disagree on a money figure.
//
// Returns ONLY totals — no rate, no baseline, no margin on the wire.
//
// AUTH: admin + internal PM only (same audience as the rep profile). Honors
// ?viewAs= consistently with /api/data + /api/blitzes (resolveEffectiveUser;
// audit actor = the REAL user). The admin+PM gate is evaluated on the
// EFFECTIVE user: while an admin is impersonating a rep, this admin-only
// screen returns 403 — the impersonated view shows ONLY what the rep sees,
// and a rep has no rep-profile commission breakdown.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let realUser;
  try { realUser = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const { effectiveUser, impersonating } = await resolveEffectiveUser(
    realUser, req.nextUrl.searchParams.get('viewAs'), getInternalUserById,
  );
  if (impersonating) {
    logger.info('view_as_read', {
      route: '/api/reps/[id]/commission-by-role',
      actorId: realUser.id,
      effectiveUserId: effectiveUser.id,
    });
  }

  // Admin + internal PM only — gated on the EFFECTIVE user so impersonation
  // narrows to the rep's (zero) access to this admin tool.
  if (!(effectiveUser.role === 'admin' || isInternalPM(effectiveUser))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Target rep must exist + be active (parity with the rep-profile lookup).
  const rep = await prisma.user.findFirst({ where: { id, active: true }, select: { id: true } });
  if (!rep) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Scope: the target rep's payroll, plus every project they're a party to
  // (needed to classify Deal entries + to count Closer deals). Trainer/Bonus
  // entries classify without a project. Reading raw amountCents avoids a
  // cents→dollars→cents round-trip — totals stay exact integers.
  const [payroll, projects] = await Promise.all([
    prisma.payrollEntry.findMany({
      where: { repId: id },
      select: { amountCents: true, status: true, type: true, paymentStage: true, projectId: true, notes: true },
    }),
    prisma.project.findMany({
      where: {
        OR: [
          { closerId: id },
          { setterId: id },
          { additionalClosers: { some: { userId: id } } },
          { additionalSetters: { some: { userId: id } } },
        ],
      },
      select: {
        id: true,
        closerId: true,
        setterId: true,
        phase: true,
        additionalClosers: { select: { userId: true } },
        additionalSetters: { select: { userId: true } },
      },
    }),
  ]);

  const roles = commissionByRole(
    payroll,
    // The DB closer column serializes to `repId` on the wire — the classifier
    // treats `repId` as the closer, so map it here.
    projects.map((p) => ({
      id: p.id,
      repId: p.closerId,
      setterId: p.setterId,
      phase: p.phase,
      additionalClosers: p.additionalClosers,
      additionalSetters: p.additionalSetters,
    })),
    id,
  );

  return NextResponse.json({ roles });
}
