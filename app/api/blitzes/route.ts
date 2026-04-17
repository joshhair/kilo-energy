import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createBlitzSchema } from '../../../lib/schemas/business';
import { serializeProject, serializeBlitzCost } from '../../../lib/serialize';

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
  // Reps see: blitzes they're involved in (any status) OR upcoming/active
  // blitzes they haven't joined yet (so the "Browse Available" section works).
  const where: Record<string, unknown> =
    user.role === 'admin' || user.role === 'project_manager'
      ? {}
      : {
          OR: [
            { ownerId: user.id },
            { createdById: user.id },
            { participants: { some: { userId: user.id, joinStatus: { in: ['approved', 'pending'] } } } },
            { status: { in: ['upcoming', 'active'] } },
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
        include: { closer: true, setter: true, installer: true, financer: true, additionalClosers: { include: { user: true } }, additionalSetters: { include: { user: true } } },
      },
      incentives: { include: { milestones: true } },
    },
    orderBy: { startDate: 'desc' },
  });

  // Non-admins: strip other reps' financial data from projects + hide costs
  if (user.role !== 'admin') {
    for (const b of blitzes) {
      (b as { costs: unknown[] }).costs = [];
      for (const p of b.projects) {
        const isMyDeal = p.closerId === user.id || p.setterId === user.id
          || p.additionalClosers.some((ac: { userId: string }) => ac.userId === user.id)
          || p.additionalSetters.some((as: { userId: string }) => as.userId === user.id);
        if (!isMyDeal) {
          p.netPPW = 0;
          p.m1AmountCents = 0;
          p.m2AmountCents = 0;
          p.m3AmountCents = 0;
          p.setterM1AmountCents = 0;
          p.setterM2AmountCents = 0;
          p.setterM3AmountCents = 0;
        }
      }
    }
  }

  // Wire format is dollars; convert at the seam.
  const serialized = blitzes.map((b) => ({
    ...b,
    projects: b.projects.map(serializeProject),
    costs: b.costs.map(serializeBlitzCost),
  }));
  return NextResponse.json(serialized);
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

  const parsed = await parseJsonBody(req, createBlitzSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Force createdById + ownerId to the current user unless admin supplies an ownerId override.
  const ownerId = user.role === 'admin' && body.ownerId ? body.ownerId : user.id;
  const createdById = user.id;

  const blitz = await prisma.blitz.create({
    data: {
      name: body.name,
      location: body.location ?? '',
      housing: body.housing ?? '',
      startDate: body.startDate,
      endDate: body.endDate,
      notes: body.notes ?? '',
      status: body.status,
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
  const serialized = {
    ...blitz,
    projects: blitz.projects.map(serializeProject),
    costs: blitz.costs.map(serializeBlitzCost),
  };
  return NextResponse.json(serialized, { status: 201 });
}
