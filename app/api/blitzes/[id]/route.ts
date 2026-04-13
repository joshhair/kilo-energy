import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser } from '../../../../lib/api-auth';

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

  return NextResponse.json(blitz);
}

// PATCH /api/blitzes/[id] — Update blitz (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) {
      return NextResponse.json({ error: 'Blitz name is required' }, { status: 400 });
    }
    data.name = body.name;
  }
  if (body.location !== undefined) data.location = body.location;
  if (body.housing !== undefined) data.housing = body.housing;
  if (body.startDate !== undefined) data.startDate = body.startDate;
  if (body.endDate !== undefined) data.endDate = body.endDate;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.status !== undefined) data.status = body.status;
  if (body.ownerId !== undefined) data.ownerId = body.ownerId;

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
