import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchBlitzRequestSchema } from '../../../../lib/schemas/business';

// PATCH /api/blitz-requests/[id] — Approve/deny a request (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchBlitzRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.adminNotes !== undefined) data.adminNotes = body.adminNotes;

  let request;
  try {
    request = await prisma.$transaction(async (tx) => {
      const updated = await tx.blitzRequest.update({
        where: { id },
        data,
        include: { requestedBy: true, blitz: true },
      });

      // If approving a cancellation request, also cancel the blitz and unlink projects
      if (body.status === 'approved' && updated.type === 'cancel' && updated.blitzId) {
        const currentBlitz = await tx.blitz.findUnique({ where: { id: updated.blitzId }, select: { status: true } });
        if (!currentBlitz || !['upcoming', 'active'].includes(currentBlitz.status)) {
          throw new Error(`Cannot cancel blitz in '${currentBlitz?.status ?? 'unknown'}' status`);
        }
        await tx.blitz.update({
          where: { id: updated.blitzId },
          data: { status: 'cancelled' },
        });
        await tx.project.updateMany({
          where: { blitzId: updated.blitzId },
          data: { blitzId: null },
        });
      }

      // If approving a create request, create the blitz (idempotency: skip if already linked)
      if (body.status === 'approved' && updated.type === 'create' && !updated.blitzId) {
        const newBlitz = await tx.blitz.create({
          data: {
            name: updated.name,
            location: updated.location,
            startDate: updated.startDate,
            endDate: updated.endDate,
            housing: updated.housing,
            notes: updated.notes,
            createdById: updated.requestedById,
            ownerId: updated.requestedById,
            participants: {
              create: { userId: updated.requestedById, joinStatus: 'approved' },
            },
          },
        });
        const updatedWithBlitz = await tx.blitzRequest.update({
          where: { id },
          data: { blitzId: newBlitz.id },
          include: { requestedBy: true, blitz: true },
        });
        return updatedWithBlitz;
      }

      return updated;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed';
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  // Backfill existing deals for newly-approved create requests (mirrors POST /api/blitzes lines 150–189)
  if (body.status === 'approved' && request.type === 'create' && request.blitz) {
    const newBlitz = request.blitz;
    const ownerId = request.requestedById;
    const approvedParticipants = await prisma.blitzParticipant.findMany({
      where: { blitzId: newBlitz.id, joinStatus: 'approved' },
      select: { userId: true },
    });
    const approvedIds = approvedParticipants.map((p) => p.userId);
    await prisma.project.updateMany({
      where: {
        blitzId: null,
        soldDate: { gte: newBlitz.startDate, lte: newBlitz.endDate },
        closerId: ownerId,
        OR: [{ setterId: null }, { setterId: { in: approvedIds } }],
      },
      data: { blitzId: newBlitz.id },
    });
    await prisma.project.updateMany({
      where: {
        blitzId: null,
        soldDate: { gte: newBlitz.startDate, lte: newBlitz.endDate },
        setterId: ownerId,
        closerId: { in: approvedIds },
      },
      data: { blitzId: newBlitz.id },
    });
    const coRoleProjects = await prisma.project.findMany({
      where: {
        blitzId: null,
        soldDate: { gte: newBlitz.startDate, lte: newBlitz.endDate },
        OR: [
          { additionalClosers: { some: { userId: ownerId } } },
          { additionalSetters: { some: { userId: ownerId } } },
        ],
      },
      select: { id: true },
    });
    for (const project of coRoleProjects) {
      await prisma.project.update({ where: { id: project.id }, data: { blitzId: newBlitz.id } });
    }
  }

  return NextResponse.json(request);
}
