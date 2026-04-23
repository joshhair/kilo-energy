import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser, userCanAccessProject, isVendorPM } from '../../../../../lib/api-auth';

// GET /api/projects/[id]/mentionable — list of users the current viewer
// can @-tag when chattering on this project. Names only (no email/phone)
// — this is a tagging autocomplete, not a contact directory.
//
// Scope rules:
//   admin / internal PM: everyone (all active users)
//   vendor PM: only users who appear on a project within their
//              installer scope, as closer / setter / co-closer /
//              co-setter / trainer / sub-dealer — plus admins (so
//              the installer-side PM can loop in Kilo staff).
//   rep / sub-dealer: active reps + admins (existing pre-vendor-PM
//              behavior, now returned here instead of the client
//              building it from useApp().reps).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (isVendorPM(user)) {
    // Gather user IDs from every role-slot on every project in scope,
    // then load names. Admins are always included so the vendor PM can
    // loop in Kilo staff even if they aren't on a specific deal.
    const projects = await prisma.project.findMany({
      where: { installerId: user.scopedInstallerId! },
      select: {
        closerId: true,
        setterId: true,
        trainerId: true,
        subDealerId: true,
        additionalClosers: { select: { userId: true } },
        additionalSetters: { select: { userId: true } },
      },
    });
    const ids = new Set<string>();
    for (const p of projects) {
      if (p.closerId) ids.add(p.closerId);
      if (p.setterId) ids.add(p.setterId);
      if (p.trainerId) ids.add(p.trainerId);
      if (p.subDealerId) ids.add(p.subDealerId);
      for (const c of p.additionalClosers) ids.add(c.userId);
      for (const s of p.additionalSetters) ids.add(s.userId);
    }
    const users = await prisma.user.findMany({
      where: {
        active: true,
        OR: [
          { id: { in: Array.from(ids) } },
          { role: 'admin' },
        ],
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: 'asc' },
    });
    return NextResponse.json(
      users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role })),
    );
  }

  // Admin / internal PM / rep / sub-dealer: all active users.
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: { firstName: 'asc' },
  });
  return NextResponse.json(
    users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role })),
  );
}
