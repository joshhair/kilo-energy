import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchBlitzSchema } from '../../../../lib/schemas/business';

// GET /api/blitzes/[id] — Get a single blitz. Access:
// - admin, project_manager: yes
// - owner, creator, or approved participant: yes
// - everyone else: 403
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const blitz = await prisma.blitz.findUnique({
    where: { id },
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
  });
  if (!blitz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ─── PM canAccessBlitz gate (mirrors GET /api/blitzes) ───
  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({ where: { id: user.id }, select: { canAccessBlitz: true } });
    if (!pm?.canAccessBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz access not enabled' }, { status: 403 });
    }
  }

  // ─── Visibility check ───
  if (user.role !== 'admin' && user.role !== 'project_manager') {
    const isOwner = blitz.ownerId === user.id;
    const isCreator = blitz.createdById === user.id;
    const isParticipant = blitz.participants.some(
      (p) => p.userId === user.id && (p.joinStatus === 'approved' || p.joinStatus === 'pending'),
    );
    if (!isOwner && !isCreator && !isParticipant) {
      return NextResponse.json({ error: 'Forbidden — not a participant' }, { status: 403 });
    }
  }

  // Non-admins: strip other reps' financial data from projects + hide costs.
  // Using `as unknown as` tightens the cast vs `any` — explicit about what
  // shape we're forcing, and only the fields we actually mutate.
  if (user.role !== 'admin') {
    (blitz as unknown as { costs: unknown[] }).costs = [];
    for (const p of blitz.projects) {
      const isMyDeal = p.closerId === user.id || p.setterId === user.id;
      if (!isMyDeal) {
        const mp = p as unknown as {
          netPPW: number;
          m1Amount: number;
          m2Amount: number;
          m3Amount: number;
          setterM1Amount: number;
          setterM2Amount: number;
          setterM3Amount: number;
        };
        mp.netPPW = 0;
        mp.m1Amount = 0;
        mp.m2Amount = 0;
        mp.m3Amount = 0;
        mp.setterM1Amount = 0;
        mp.setterM2Amount = 0;
        mp.setterM3Amount = 0;
      }
    }
  }

  return NextResponse.json(blitz);
}

// PATCH /api/blitzes/[id] — Update blitz (admin or blitz owner)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  if (user.role !== 'admin') {
    const existing = await prisma.blitz.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.ownerId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, patchBlitzSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.location !== undefined) data.location = body.location;
  if (body.housing !== undefined) data.housing = body.housing;
  if (body.startDate !== undefined) data.startDate = body.startDate;
  if (body.endDate !== undefined) data.endDate = body.endDate;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.status !== undefined) data.status = body.status;
  if (body.ownerId !== undefined && user.role === 'admin') data.ownerId = body.ownerId;

  const blitz = await prisma.blitz.update({
    where: { id },
    data,
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: true,
      projects: true,
    },
  });

  // Unlink projects whose soldDate falls outside the updated date window
  if (body.startDate !== undefined || body.endDate !== undefined) {
    await prisma.project.updateMany({
      where: {
        blitzId: id,
        OR: [
          ...(blitz.startDate ? [{ soldDate: { lt: blitz.startDate } }] : []),
          ...(blitz.endDate ? [{ soldDate: { gt: blitz.endDate } }] : []),
        ],
      },
      data: { blitzId: null },
    });
    blitz.projects = await prisma.project.findMany({
      where: { blitzId: id },
      include: { closer: true, setter: true, installer: true, financer: true },
    });
  }

  // Non-admins: strip other reps' financial data from projects + hide costs.
  // Using `as unknown as` tightens the cast vs `any` — explicit about what
  // shape we're forcing, and only the fields we actually mutate.
  if (user.role !== 'admin') {
    (blitz as unknown as { costs: unknown[] }).costs = [];
    for (const p of blitz.projects) {
      const isMyDeal = p.closerId === user.id || p.setterId === user.id;
      if (!isMyDeal) {
        const mp = p as unknown as {
          netPPW: number;
          m1Amount: number;
          m2Amount: number;
          m3Amount: number;
          setterM1Amount: number;
          setterM2Amount: number;
          setterM3Amount: number;
        };
        mp.netPPW = 0;
        mp.m1Amount = 0;
        mp.m2Amount = 0;
        mp.m3Amount = 0;
        mp.setterM1Amount = 0;
        mp.setterM2Amount = 0;
        mp.setterM3Amount = 0;
      }
    }
  }

  return NextResponse.json(blitz);
}

// DELETE /api/blitzes/[id] — Admin only
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  await prisma.project.updateMany({ where: { blitzId: id }, data: { blitzId: null } });
  await prisma.blitz.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
