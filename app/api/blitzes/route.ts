import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser } from '../../../lib/api-auth';

// GET /api/blitzes — List blitzes scoped to the current user's role.
// Admin: all blitzes. PM: all blitzes if canAccessBlitz is true. Others:
// only blitzes they own, created, or participate in (approved status).
export async function GET() {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({ where: { id: user.id }, select: { canAccessBlitz: true } });
    if (!pm?.canAccessBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz access not enabled' }, { status: 403 });
    }
  }

  // ─── Build a where clause that limits non-admin/non-PM users ───
  const where: Record<string, unknown> =
    user.role === 'admin' || user.role === 'project_manager'
      ? {}
      : {
          OR: [
            { ownerId: user.id },
            { createdById: user.id },
            { participants: { some: { userId: user.id, joinStatus: { in: ['approved', 'pending'] } } } },
          ],
        };

  const blitzes = await prisma.blitz.findMany({
    where,
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: { orderBy: { date: 'desc' } },
      projects: {
        include: { closer: true, setter: true, installer: true, financer: true },
      },
      incentives: { include: { milestones: true } },
    },
    orderBy: { startDate: 'desc' },
  });

  // Non-admins: strip other reps' financial data from projects + hide costs
  if (user.role !== 'admin') {
    for (const b of blitzes) {
      (b as any).costs = [];
      for (const p of b.projects) {
        const isMyDeal = p.closerId === user.id || p.setterId === user.id;
        if (!isMyDeal) {
          (p as any).netPPW = 0;
          (p as any).m1Amount = 0;
          (p as any).m2Amount = 0;
          (p as any).m3Amount = 0;
          (p as any).setterM1Amount = 0;
          (p as any).setterM2Amount = 0;
          (p as any).setterM3Amount = 0;
        }
      }
    }
  }

  return NextResponse.json(blitzes);
}

// POST /api/blitzes — Create a new blitz. Admin or user with canCreateBlitz.
// Owner/createdBy are forced to the current user to prevent spoofing.
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  if (user.role !== 'admin') {
    const u = await prisma.user.findUnique({ where: { id: user.id }, select: { canCreateBlitz: true } });
    if (!u?.canCreateBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz creation not enabled' }, { status: 403 });
    }
  }

  const body = await req.json();

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (!body.startDate || !body.endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 });
  }

  // Force createdById + ownerId to the current user unless admin supplies an ownerId override.
  const ownerId = user.role === 'admin' && body.ownerId ? body.ownerId : user.id;
  const createdById = user.id;

  const blitz = await prisma.blitz.create({
    data: {
      name: body.name,
      location: body.location || '',
      housing: body.housing || '',
      startDate: body.startDate,
      endDate: body.endDate,
      notes: body.notes || '',
      status: body.status || 'upcoming',
      createdById,
      ownerId,
      // Auto-add the owner as an approved participant
      participants: {
        create: { userId: ownerId, joinStatus: 'approved' },
      },
    },
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: true,
      projects: true,
    },
  });
  return NextResponse.json(blitz, { status: 201 });
}
